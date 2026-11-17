import { readFileSync } from "node:fs";
import path from "node:path";
import { aiMode, getClient, MODEL } from "../ai/assistant";
import { checkReply, numbersIn } from "../ai/safety";
import { formatDate, formatMoney, nowIso } from "../clock";
import type { BranchReport, CustomerId, NightlyReport, Tier } from "../contract";
import { isCustomerId } from "../data";
import { audit, getCases, getSession, saveReport, takeAiCall } from "../store";
import { TIER_NAMES } from "../tier/config";

// The nightly report (the Risk Reporting service in docs/architecture.md).
// The risk run covers every customer of the bank; the report is cut per branch so each
// branch sees its own picture. It runs on a clock, after the risk run, never because of
// one customer's action. Rules count everything. The AI only writes the short summary,
// and a summary that states a figure the rules did not produce is thrown away.

/** One customer's line in data/ml-cohort.json (written by scripts/export-ml-cohort.py). */
interface CohortRow {
  id: string;
  branch: string;
  tier: number | null;
  signals: string[];
  shortfall: number;
  shortfall_date: string | null;
  ml_band: "High" | "Elevated" | "Low" | null;
}

interface Cohort {
  source: string;
  as_of_date: string;
  forecast_days: number;
  branches: string[];
  customers: CohortRow[];
}

const SIGNAL_LABELS: Record<string, string> = {
  LOW_BUFFER: "Low cash buffer",
  NEGATIVE_CASHFLOW: "More going out than coming in",
  LOW_COVERAGE: "Income close to or below bills",
  BALANCE_DECLINE: "Balance falling",
  INCOME_DROP: "Income well below usual",
  INCOME_OVERDUE: "Expected pay is late",
  FAILED_OTHER_PAYMENTS: "Other failed payments",
  STRESS_SCENARIO_GAP: "Short if pay comes in low",
};

let cache: Cohort | null = null;
const cohort = (): Cohort =>
  (cache ??= JSON.parse(readFileSync(path.join(process.cwd(), "data", "ml-cohort.json"), "utf8")) as Cohort);

/** What CareLoop has done so far for the customers it talks to, counted for one branch. */
function careloopCounts(rows: CohortRow[]): BranchReport["careloop"] {
  const live = rows.map((r) => r.id).filter(isCustomerId) as CustomerId[];
  const cases = getCases().filter((c) => live.includes(c.customerId));
  const headsUp = live.filter((id) => getSession(id).messages.some((m) => m.card?.type === "alert"));
  const waiting = cases.filter((c) => ["new", "in_review", "priority_assist"].includes(c.status));
  const contacted = new Set<string>([...headsUp, ...cases.map((c) => c.customerId)]);
  return {
    headsUps: headsUp.length,
    requests: cases.length,
    waiting: waiting.length,
    arrangements: cases.filter((c) => c.status === "arrangement").length,
    callBacks: waiting.filter((c) => c.callbackBy).length,
    nextDeadline: waiting.map((c) => c.respondBy).sort()[0] ?? null,
    notContacted: rows.filter((r) => (r.tier ?? 0) >= 2 && !contacted.has(r.id)).length,
  };
}

/** The same figures in a sentence, used when the AI is off or its summary is thrown away. */
function rulesSummary(r: Omit<BranchReport, "summary">, forecastDays: number): string {
  const atRisk = r.tiers[2].count + r.tiers[3].count;
  const peak = r.shortfalls.peak;
  return [
    `${atRisk} of ${r.customers} customers at ${r.branch} are at tier 2 or 3 tonight.`,
    r.shortfalls.customers
      ? `${r.shortfalls.customers} repayments worth ${formatMoney(r.shortfalls.total)} may not be covered in the next ${forecastDays} days${peak ? `, most of them on ${formatDate(peak.date)}` : ""}.`
      : `No repayment is forecast to fall short in the next ${forecastDays} days.`,
    `${r.careloop.notContacted} of the tier 2 and 3 customers have had no heads-up yet.`,
  ].join(" ");
}

function branchFigures(branch: string): Omit<BranchReport, "summary"> {
  const rows = cohort().customers.filter((r) => r.branch === branch);
  const short = rows.filter((r) => r.shortfall > 0 && r.shortfall_date);
  const byDay = new Map<string, { customers: number; amount: number }>();
  for (const r of short) {
    const day = byDay.get(r.shortfall_date!) ?? { customers: 0, amount: 0 };
    byDay.set(r.shortfall_date!, { customers: day.customers + 1, amount: day.amount + r.shortfall });
  }
  const days = [...byDay.entries()].map(([date, d]) => ({ date, ...d })).sort((a, b) => a.date.localeCompare(b.date));
  const flagged = rows.filter((r) => (r.tier ?? 0) >= 1);
  const signalCounts = new Map<string, number>();
  for (const r of flagged) for (const code of r.signals) signalCounts.set(code, (signalCounts.get(code) ?? 0) + 1);
  return {
    branch,
    customers: rows.length,
    tiers: ([0, 1, 2, 3] as Tier[]).map((tier) => ({ tier, name: TIER_NAMES[tier], count: rows.filter((r) => r.tier === tier).length })),
    notAssessed: rows.filter((r) => r.tier === null).length,
    shortfalls: {
      customers: short.length,
      total: short.reduce((sum, r) => sum + r.shortfall, 0),
      days,
      peak: days.length ? days.reduce((best, d) => (d.amount > best.amount ? d : best)) : null,
    },
    signals: [...signalCounts.entries()]
      .map(([code, count]) => ({ code, label: SIGNAL_LABELS[code] ?? code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4),
    mlAgrees: rows.filter((r) => (r.tier ?? 0) >= 2 && r.ml_band === "High").length,
    careloop: careloopCounts(rows),
  };
}

const SUMMARY_PROMPT = `You write the three-sentence summary at the top of a nightly branch report for the Westpac Assist team.
The figures in <figures> were counted by rules. Use only those figures, exactly as given: do not round, add, subtract or work out percentages.
Say what a branch manager should notice first: how many customers are at tier 2 or 3, when the uncovered repayments land, and how many of those customers have not had a heads-up yet.
Plain English, at most three sentences, no bullet points, no headings, no em dashes. Never name or describe an individual customer. Never suggest what the bank will decide.`;

/** The AI's summary of one branch, or null when it fails or states a figure the rules did not produce. */
async function aiSummary(figures: Omit<BranchReport, "summary">, forecastDays: number): Promise<string | null> {
  const peak = figures.shortfalls.peak;
  const given = {
    branch: figures.branch,
    customers: figures.customers,
    customers_by_tier: Object.fromEntries(figures.tiers.map((t) => [`tier ${t.tier} (${t.name})`, t.count])),
    customers_at_tier_2_or_3: figures.tiers[2].count + figures.tiers[3].count,
    forecast_days: forecastDays,
    repayments_that_may_not_be_covered: figures.shortfalls.customers,
    total_uncovered: formatMoney(figures.shortfalls.total),
    biggest_day: peak ? { date: formatDate(peak.date), repayments: peak.customers, amount: formatMoney(peak.amount) } : null,
    most_common_signals: figures.signals.map((s) => ({ signal: s.label, customers: s.count })),
    tier_2_or_3_also_ranked_high_by_ml: figures.mlAgrees,
    careloop: {
      heads_ups_sent: figures.careloop.headsUps,
      requests_filed: figures.careloop.requests,
      waiting_for_a_person: figures.careloop.waiting,
      arrangements_in_place: figures.careloop.arrangements,
      next_reply_deadline: figures.careloop.nextDeadline ? formatDate(figures.careloop.nextDeadline) : null,
      tier_2_or_3_with_no_heads_up_yet: figures.careloop.notContacted,
    },
  };
  const trusted = JSON.stringify(given);
  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: "low" },
      system: SUMMARY_PROMPT,
      messages: [{ role: "user", content: `<figures>\n${JSON.stringify(given, null, 1)}\n</figures>` }],
    });
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").replace(/\s+/g, " ").trim();
    if (!text) return null;
    const allowed = new Set(numbersIn(trusted));
    const invented = numbersIn(text).filter((n) => !allowed.has(n));
    const verdict = checkReply(text, trusted);
    if (invented.length || !verdict.ok) {
      audit("report", "safety", `Report summary for ${figures.branch} thrown away (${invented.length ? `figure not from the rules: ${invented.join(", ")}` : verdict.problem}): ${text}`);
      return null;
    }
    return text;
  } catch (error) {
    audit("report", "safety", `Report summary for ${figures.branch}: AI unavailable (${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}); rules summary used`);
    return null;
  }
}

/** Tonight's report for every branch. In production a timer starts this after the nightly risk run. */
export async function runNightlyReport(): Promise<NightlyReport> {
  const data = cohort();
  const useAi = aiMode() === "claude";
  const branches = await Promise.all(
    data.branches.map(async (branch): Promise<BranchReport> => {
      const figures = branchFigures(branch);
      const written = useAi && takeAiCall() ? await aiSummary(figures, data.forecast_days) : null;
      return { ...figures, summary: written ? { text: written, by: "ai" } : { text: rulesSummary(figures, data.forecast_days), by: "rules" } };
    }),
  );
  const report: NightlyReport = {
    generatedAt: nowIso(),
    asOf: data.as_of_date,
    forecastDays: data.forecast_days,
    totalCustomers: data.customers.length,
    branches,
  };
  saveReport(report);
  audit("report", "message", `Nightly report built for ${branches.length} branches from ${report.totalCustomers} customers (${branches.filter((b) => b.summary.by === "ai").length} summaries by AI)`);
  return report;
}
