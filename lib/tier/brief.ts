import { daysBetween, formatDate, formatMoney } from "../clock";
import type { RiskBrief, Schedule, TierResult } from "../contract";
import type { MlRecord } from "../data";

// A quick-read brief for staff: one headline, then each warning signal as
// "what | this customer | the rule's line". Every value is the ML service's;
// the lines are its demo thresholds (careloop/config.py), not Westpac policy.

const num = (v: number | boolean | null | undefined): number | null => (typeof v === "number" ? v : null);
const pct = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(Math.round(n * 100))}%`;

export function buildBrief(record: MlRecord, schedule: Schedule, tier: TierResult, today: string): RiskBrief {
  const f = record.analysis.features;
  const { shortfall, stressShortfall } = tier.projection;
  const failed = schedule.pastRepayments.filter((p) => p.status === "failed" && daysBetween(p.date, today) <= 30).at(-1);

  const headline: RiskBrief["headline"] = failed
    ? {
        tone: "danger",
        title: `${failed.product} repayment of ${formatMoney(failed.amount)} failed on ${formatDate(failed.date)}`,
        detail: shortfall ? `Next gap: ${formatMoney(shortfall.amount)} short on ${formatDate(shortfall.date)}` : "No further gap in the next 14 days",
      }
    : shortfall
      ? {
          tone: "danger",
          title: `${formatMoney(shortfall.amount)} short on ${formatDate(shortfall.date)}`,
          detail: `in ${daysBetween(today, shortfall.date)} days · stress case up to ${formatMoney(stressShortfall)} · confidence ${tier.projection.confidence}`,
        }
      : {
          tone: tier.tier >= 1 ? "warning" : "neutral",
          title: "No shortfall in the next 14 days",
          detail: stressShortfall > 0 ? `stress case: ${formatMoney(stressShortfall)} short` : `${record.analysis.warning_signals.length} warning signals`,
        };

  const rows: RiskBrief["signals"] = [];
  for (const code of record.analysis.warning_signals) {
    switch (code) {
      // Each value says what it measures ("5.1 days of essentials"), so it is not read as a deadline.
      case "LOW_BUFFER":
        rows.push({ code, label: "Cash buffer", value: `${num(f.cash_buffer_days)?.toFixed(1)} days of essentials`, line: "under 14 days" });
        break;
      case "NEGATIVE_CASHFLOW":
        rows.push({ code, label: "Last 30 days", value: `${formatMoney(-(num(f.net_cash_flow_30d) ?? 0))} more out than in`, line: "more out than in" });
        break;
      case "LOW_COVERAGE":
        rows.push({ code, label: "Next 30 days", value: `income covers ${pct(num(f.repayment_coverage_ratio) ?? 0)} of bills`, line: "under 110%" });
        break;
      case "BALANCE_DECLINE":
        rows.push({ code, label: "Average balance vs last month", value: `down ${pct(-(num(f.balance_change_30d) ?? 0))} (${formatMoney(-(num(f.balance_change_30d_aud) ?? 0))})`, line: "down 25% and $200" });
        break;
      case "INCOME_DROP":
        rows.push({
          code,
          label: "Income, last 4 weeks",
          value: (num(f.income_change_pct) ?? 0) <= -0.99 ? "no income" : `${pct(-(num(f.income_change_pct) ?? 0))} below usual`,
          line: "20% below usual",
        });
        break;
      case "INCOME_OVERDUE":
        rows.push({ code, label: "Last pay", value: `${num(f.income_gap_days)} days ago (usually every ${num(f.expected_income_cadence_days)})`, line: "1.5 × the usual gap" });
        break;
      case "FAILED_OTHER_PAYMENTS":
        rows.push({ code, label: "Other payments, last 30 days", value: `${num(f.failed_other_payments_30d) ?? 0} failed`, line: "1 or more failed" });
        break;
      case "STRESS_SCENARIO_GAP":
        rows.push({ code, label: "If pay comes in lower", value: `${formatMoney(stressShortfall)} short`, line: "any shortfall" });
        break;
    }
  }
  // The part staff scan for: the first figure in each value ("5.1 days", "$723", "83%"), or "no income".
  for (const row of rows) row.strong = row.value.match(/\$[\d,]+|\d+(\.\d+)?%|\d+(\.\d+)? days|\d+|no income/)?.[0];

  const note = record.analysis.reason_codes.includes("RESERVES_COVER_DEFICIT")
    ? "Spending is above income, but savings cover 90+ days of essentials, so cash-flow signals don't count."
    : undefined;
  return { headline, signals: rows, ...(note ? { note } : {}) };
}
