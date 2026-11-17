import { addDays, daysBetween, formatDate, formatMoney } from "../clock";
import type { Customer, Projection, ProjectionPoint, Schedule, Signals, Tier, TierResult, TimelineItem } from "../contract";
import type { MlRecord } from "../data";
import { TIER_CONFIG as C, TIER_NAMES } from "./config";

// The tier engine is the ML service's (careloop/tiers.py). This file only turns its
// result into the shapes the app shows. No figure is recomputed here, and no AI is used.

export interface TierInput {
  customer: Customer;
  schedule: Schedule;
  /** The ML service's result for this customer. */
  record: MlRecord;
  today: string;
  /** Set by the conversation when the customer discloses a sensitive situation. */
  sensitive?: boolean;
}

const num = (v: number | boolean | null | undefined): number | null => (typeof v === "number" ? v : null);
const pct = (n: number) => `${Math.abs(Math.round(n * 100))}%`;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
/** "Car registration renewal (notice received 26 Oct)" -> "Car registration renewal". */
const tidy = (description: string) => description.replace(/\s*\(.*\)$/, "");

/** Where the pay dropped: the first pay of a run that stays well below the pays before it. */
function payDrop(pays: { date: string; amount: number }[]): { index: number; usual: number } | null {
  for (let i = 1; i < pays.length; i++) {
    const usual = median(pays.slice(0, i).map((p) => p.amount))!;
    if (pays.slice(i).every((p) => p.amount <= usual * 0.85)) return { index: i, usual };
  }
  return null;
}

export function toSignals({ record, sensitive }: TierInput): Signals {
  const f = record.analysis.features;
  const codes = record.analysis.reason_codes;
  const pays = record.pays;
  const drop = payDrop(pays);
  const overdue = codes.includes("INCOME_OVERDUE");
  return {
    incomeChange: num(f.income_change_pct),
    recentPay: overdue ? null : (pays.at(-1)?.amount ?? null),
    earlierPay: drop ? drop.usual : median(pays.map((p) => p.amount)),
    bufferDays: num(f.cash_buffer_days),
    netCashFlow30d: num(f.net_cash_flow_30d),
    missedRepayment: codes.includes("MISSED_REPAYMENT"),
    warningSignals: record.analysis.warning_signals,
    sensitive: !!sensitive,
  };
}

/** The ML service's base-case 14-day forecast, as chart points and plain assumptions. */
export function toProjection({ record, today }: TierInput): Projection {
  const fc = record.analysis.forecast;
  const label = (e: (typeof fc.events)[number]) => (e.event_type === "income" ? "Pay" : tidy(e.description));
  const points: ProjectionPoint[] = [{ date: today, balance: fc.start_balance_aud }];
  for (const day of fc.daily_balances) {
    const events = fc.events.filter((e) => e.date === day.date).map(label);
    points.push({ date: day.date, balance: day.balance, ...(events.length ? { event: events.join(", ") } : {}) });
  }
  return {
    points,
    shortfall: fc.shortfall_amount_aud > 0 && fc.shortfall_date ? { amount: fc.shortfall_amount_aud, date: fc.shortfall_date } : null,
    stressShortfall: fc.conservative.shortfall_amount_aud,
    confidence: fc.confidence,
    assumptions: [
      `Balance today: ${formatMoney(fc.start_balance_aud)}`,
      ...fc.events.map((e) =>
        e.event_type === "income"
          ? `Next pay: ${formatMoney(e.amount_aud)} on ${formatDate(e.date)} (your usual pay lately)`
          : `${tidy(e.description)}: ${formatMoney(Math.abs(e.amount_aud))} on ${formatDate(e.date)}`,
      ),
      "Groceries and other everyday spending are not included",
    ],
  };
}

/** Staff-facing reasons, in the ML service's order, with its own figures. */
function explain(input: TierInput, signals: Signals, projection: Projection): string[] {
  const { record, schedule, today } = input;
  const f = record.analysis.features;
  const reasons: string[] = [];
  if (signals.sensitive) reasons.push("The customer shared a sensitive situation: specialist support, alerts paused");
  for (const code of record.analysis.reason_codes) {
    switch (code) {
      case "MISSED_REPAYMENT":
        for (const r of schedule.pastRepayments.filter((p) => p.status === "failed" && daysBetween(p.date, today) <= 30)) {
          reasons.push(`${r.product} repayment of ${formatMoney(r.amount)} failed on ${formatDate(r.date)}`);
        }
        break;
      case "EXPECTED_REPAYMENT_GAP":
        if (projection.shortfall) {
          reasons.push(`Projected ${formatMoney(projection.shortfall.amount)} short on ${formatDate(projection.shortfall.date)} (in ${daysBetween(today, projection.shortfall.date)} days), after known bills`);
        }
        break;
      case "STRESS_SCENARIO_GAP":
        reasons.push(`Could be ${formatMoney(projection.stressShortfall)} short if pay comes in lower (stress case)`);
        break;
      case "LOW_BUFFER":
        reasons.push(`Available money covers ${num(f.cash_buffer_days)?.toFixed(1)} days of essentials (under ${C.warningBufferDays})`);
        break;
      case "NEGATIVE_CASHFLOW":
        reasons.push(`${formatMoney(-(num(f.net_cash_flow_30d) ?? 0))} more went out than came in over 30 days`);
        break;
      case "LOW_COVERAGE":
        reasons.push(`Expected income covers ${pct(num(f.repayment_coverage_ratio) ?? 0)} of the next 30 days' bills and repayments`);
        break;
      case "BALANCE_DECLINE":
        reasons.push(`Average balance down ${pct(num(f.balance_change_30d) ?? 0)} (${formatMoney(-(num(f.balance_change_30d_aud) ?? 0))}) on last month`);
        break;
      case "INCOME_DROP":
        reasons.push(
          (num(f.income_change_pct) ?? 0) <= -0.99
            ? "No income in the last 4 weeks"
            : `Income ${pct(num(f.income_change_pct) ?? 0)} below the usual level`,
        );
        break;
      case "INCOME_OVERDUE":
        reasons.push(`No pay for ${num(f.income_gap_days)} days (usual cycle ${num(f.expected_income_cadence_days)} days)`);
        break;
      case "FAILED_OTHER_PAYMENTS":
        reasons.push(`${num(f.failed_other_payments_30d)} other automatic payments failed in the last 30 days`);
        break;
      case "RESERVES_COVER_DEFICIT":
        reasons.push("Spending is above income, but savings comfortably cover essentials");
        break;
      case "VARIABLE_INCOME_NOTED":
        reasons.push("Income varies from pay to pay (noted, not counted)");
        break;
    }
  }
  if (projection.shortfall && projection.stressShortfall > projection.shortfall.amount) {
    reasons.push(`Stress case: up to ${formatMoney(projection.stressShortfall)} short (forecast confidence ${projection.confidence})`);
  }
  return reasons;
}

/** The dated facts behind the tier: what changed, when CareLoop speaks up, and what is coming. */
function buildTimeline(input: TierInput, signals: Signals, projection: Projection, tier: Tier): TimelineItem[] {
  const { record, schedule, today } = input;
  const items: TimelineItem[] = [];
  const pays = record.pays;
  const codes = record.analysis.reason_codes;

  if (codes.includes("INCOME_OVERDUE")) {
    const last = pays.at(-1);
    if (last) items.push({ date: last.date, label: `Last pay received (${formatMoney(last.amount)})`, when: "past" });
  } else if (codes.includes("INCOME_DROP")) {
    const drop = payDrop(pays);
    if (drop) items.push({ date: pays[drop.index].date, label: `Pay dropped from ${formatMoney(drop.usual)} to ${formatMoney(pays[drop.index].amount)}`, when: "past" });
  }
  for (const r of schedule.pastRepayments.filter((p) => p.status === "failed")) {
    items.push({ date: r.date, label: `${r.product} repayment of ${formatMoney(r.amount)} failed`, when: "past" });
  }
  if (tier === 3) items.push({ date: today, label: "Help offered after the missed repayment", when: "today" });
  else if (tier >= 1 && projection.shortfall) {
    items.push({ date: today, label: `Early heads-up, ${daysBetween(today, projection.shortfall.date)} days before the repayment`, when: "today" });
  } else if (tier >= 1) items.push({ date: today, label: "Early heads-up", when: "today" });
  if (projection.shortfall) {
    items.push({ date: projection.shortfall.date, label: `Repayment due: projected ${formatMoney(projection.shortfall.amount)} short`, when: "ahead" });
  }
  // Keep only what falls inside the forecast window ahead.
  const last = addDays(today, C.forecastDays);
  return items.filter((i) => i.date <= last).sort((a, b) => a.date.localeCompare(b.date));
}

const NEXT_ACTION: TierResult["nextAction"][] = ["none", "nudge", "heads_up", "missed_payment_help"];

export function assessCustomer(input: TierInput): TierResult {
  const signals = toSignals(input);
  const projection = toProjection(input);
  const tier = (input.record.analysis.financial_tier ?? 0) as Tier;
  return {
    customerId: input.customer.id,
    tier,
    tierName: TIER_NAMES[tier],
    reasons: explain(input, signals, projection),
    signals,
    projection,
    timeline: buildTimeline(input, signals, projection, tier),
    nextAction: signals.sensitive ? "specialist_handover" : NEXT_ACTION[tier],
    // A specialist need pauses alerts. Tier 3 is ordinary missed-payment contact, which banks
    // already make. Tiers 1 and 2 need the opt-in.
    mayContact: !signals.sensitive && (tier >= 3 || (tier >= 1 && input.customer.consents.alerts)),
  };
}
