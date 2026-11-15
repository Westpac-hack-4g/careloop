import { addDays, daysBetween, formatDate, formatMoney } from "../clock";
import type { Customer, Projection, ProjectionPoint, Schedule, Signals, Tier, TierResult, TimelineItem, Transaction } from "../contract";
import { TIER_CONFIG as C, TIER_NAMES } from "./config";

// The tier engine: plain rules over account data. No AI in here.
// Every dollar figure the customer or staff ever see comes from this file.

export interface TierInput {
  customer: Customer;
  transactions: Transaction[];
  schedule: Schedule;
  today: string;
  /** Set by the conversation when the customer discloses a sensitive situation. */
  sensitive?: boolean;
}

const isPay = (t: Transaction) => t.category === "pay";
const isEverydayEssential = (t: Transaction) => t.essential && t.category !== "loan repayment";
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Transactions from `days` days before `today` up to the day before `today`, shifted back by `skip` days. */
function windowOf(transactions: Transaction[], today: string, days: number, skip = 0): Transaction[] {
  const from = addDays(today, -(days + skip));
  const to = addDays(today, -skip);
  return transactions.filter((t) => t.date >= from && t.date < to);
}

function averagePay(transactions: Transaction[]): number | null {
  const pays = transactions.filter(isPay);
  return pays.length ? pays.reduce((sum, t) => sum + t.amount, 0) / pays.length : null;
}

export function computeSignals({ customer, transactions, schedule, today, sensitive }: TierInput): Signals {
  const recent = averagePay(windowOf(transactions, today, C.recentPayWeeks * 7));
  const earlier = averagePay(windowOf(transactions, today, C.earlierPayWeeks * 7, C.recentPayWeeks * 7));
  // No pay at all in the recent window, after regular pay before it, counts as a 100% drop.
  const incomeChange = earlier === null ? null : round2((recent ?? 0) / earlier - 1);

  let netFlowNegativeMonths = 0;
  for (let month = 0; month < 3; month++) {
    const net = windowOf(transactions, today, 30, month * 30).reduce((sum, t) => sum + t.amount, 0);
    if (net >= 0) break;
    netFlowNegativeMonths++;
  }

  const card = customer.products.find((p) => p.type === "credit_card");
  const cardUse = card && card.type === "credit_card" ? round2(card.balance / card.limit) : null;
  const cardUseRising = !!card && card.type === "credit_card" && card.balance > card.balance90DaysAgo;

  return {
    incomeChange,
    recentPay: recent === null ? null : round2(recent),
    earlierPay: earlier === null ? null : round2(earlier),
    bufferTrend: round2(customer.balance / customer.balance90DaysAgo - 1),
    netFlowNegativeMonths,
    cardUse,
    cardUseRising,
    missedRepayment: schedule.pastRepayments.some((r) => r.status === "failed"),
    sensitive: !!sensitive,
  };
}

/** Walk the balance forward day by day: pays in, repayments out, average essentials out. */
export function projectBalance({ customer, transactions, schedule, today }: TierInput): Projection {
  const lookback = windowOf(transactions, today, C.essentialsLookbackDays).filter(isEverydayEssential);
  const dailyEssentials = round2(-lookback.reduce((sum, t) => sum + t.amount, 0) / C.essentialsLookbackDays);

  let balance = customer.balance;
  let shortfall: Projection["shortfall"] = null;
  const points: ProjectionPoint[] = [{ date: today, balance }];

  for (let i = 1; i <= C.projectionDays; i++) {
    const date = addDays(today, i);
    const events: string[] = [];
    balance -= dailyEssentials;
    for (const pay of schedule.upcomingPays.filter((p) => p.date === date)) {
      balance += pay.amount;
      events.push("Pay");
    }
    for (const repayment of schedule.upcomingRepayments.filter((r) => r.date === date)) {
      balance -= repayment.amount;
      events.push(`${repayment.product} repayment`);
      if (balance < 0 && !shortfall) shortfall = { amount: Math.round(-balance), date };
    }
    points.push({ date, balance: round2(balance), ...(events.length ? { event: events.join(", ") } : {}) });
  }

  const nextPay = schedule.upcomingPays[0];
  return {
    points,
    shortfall,
    assumptions: [
      `Balance today: ${formatMoney(customer.balance)}`,
      nextPay ? `Next pay: ${formatMoney(nextPay.amount)} on ${formatDate(nextPay.date)}` : "No pay expected in the next 30 days",
      `Everyday essentials: about ${formatMoney(dailyEssentials)} a day, based on your last 30 days`,
      ...schedule.upcomingRepayments.map((r) => `${r.product} repayment: ${formatMoney(r.amount)} on ${formatDate(r.date)}`),
    ],
  };
}

/** First match wins. */
export function decideTier(signals: Signals, projection: Projection): Tier {
  if (signals.sensitive) return 4;
  if (signals.missedRepayment) return 3;
  if (projection.shortfall || (signals.incomeChange !== null && signals.incomeChange <= C.incomeChangeFlag)) return 2;
  if (
    signals.bufferTrend <= C.bufferTrendFlag ||
    signals.netFlowNegativeMonths >= C.netFlowNegativeMonths ||
    (signals.cardUse !== null && signals.cardUse >= C.cardUseFlag && signals.cardUseRising)
  ) {
    return 1;
  }
  return 0;
}

function explain(signals: Signals, projection: Projection, today: string): string[] {
  const reasons: string[] = [];
  const pct = (n: number) => `${Math.abs(Math.round(n * 100))}%`;
  if (signals.sensitive) reasons.push("The customer shared a sensitive situation");
  if (signals.missedRepayment) reasons.push("A repayment was missed");
  if (projection.shortfall) {
    const days = daysBetween(today, projection.shortfall.date);
    reasons.push(`Projected ${formatMoney(projection.shortfall.amount)} short on ${formatDate(projection.shortfall.date)} (in ${days} days)`);
  }
  if (signals.incomeChange !== null && signals.incomeChange <= C.incomeChangeFlag) {
    reasons.push(`Pay is down ${pct(signals.incomeChange)} over the last ${C.recentPayWeeks} weeks`);
  }
  if (signals.bufferTrend <= C.bufferTrendFlag) reasons.push(`Balance is down ${pct(signals.bufferTrend)} over 90 days`);
  if (signals.netFlowNegativeMonths >= C.netFlowNegativeMonths) {
    reasons.push(`Spending above income ${signals.netFlowNegativeMonths} months running`);
  }
  if (signals.cardUse !== null && signals.cardUse >= C.cardUseFlag && signals.cardUseRising) {
    reasons.push(`Credit card at ${pct(signals.cardUse)} of its limit and rising`);
  }
  return reasons;
}

/** The dated facts behind the tier: what changed, when CareLoop speaks up, and what is coming. */
function buildTimeline(input: TierInput, signals: Signals, projection: Projection, tier: Tier): TimelineItem[] {
  const { transactions, schedule, today } = input;
  const items: TimelineItem[] = [];
  const pays = transactions.filter(isPay).sort((a, b) => a.date.localeCompare(b.date));

  if (signals.earlierPay !== null && signals.incomeChange !== null && signals.incomeChange <= C.incomeChangeFlag) {
    if (signals.recentPay === null) {
      const last = pays.at(-1);
      if (last) items.push({ date: last.date, label: `Last pay received (${formatMoney(last.amount)})`, when: "past" });
    } else {
      // The first pay of the lower run: every pay from it onwards is below the flag line.
      const low = (t: Transaction) => t.amount <= signals.earlierPay! * (1 + C.incomeChangeFlag);
      const first = pays.find((pay, i) => pays.slice(i).every(low));
      if (first) items.push({ date: first.date, label: `Pay dropped from ${formatMoney(signals.earlierPay)} to ${formatMoney(first.amount)}`, when: "past" });
    }
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
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

const NEXT_ACTION: TierResult["nextAction"][] = ["none", "nudge", "heads_up", "missed_payment_help", "specialist_handover"];

export function assessCustomer(input: TierInput): TierResult {
  const signals = computeSignals(input);
  const projection = projectBalance(input);
  const tier = decideTier(signals, projection);
  return {
    customerId: input.customer.id,
    tier,
    tierName: TIER_NAMES[tier],
    reasons: explain(signals, projection, input.today),
    signals,
    projection,
    timeline: buildTimeline(input, signals, projection, tier),
    nextAction: NEXT_ACTION[tier],
    // Tier 3 is ordinary missed-payment contact, which banks already make. Tiers 1 and 2 need the opt-in.
    mayContact: tier >= 3 || (tier >= 1 && input.customer.consents.alerts),
  };
}
