import type { MlOpinion } from "../contract";
import type { MlRecord } from "../data";

// The ML service's experimental score, shown to staff as a second opinion beside the tier.
// It never sets the tier. The score is a ranking, not a probability (balanced class weights
// inflate it), so staff see a band and the model's own flag line, never a percentage.

const FEATURE_LABELS: Record<string, string> = {
  cash_buffer_days: "Cash buffer (days of essentials)",
  repayment_coverage_ratio: "Income vs bills and repayments",
  income_change_pct: "Change in income",
  income_volatility: "Income ups and downs",
  net_cash_flow_30d: "Money in minus money out, 30 days",
  balance_change_30d: "Change in balance, 30 days",
  essential_expense_ratio: "Essentials vs income",
  income_gap_ratio: "Time since last pay",
  failed_loan_payments_30d: "Failed loan or card repayments, 30 days",
  failed_other_payments_30d: "Other failed payments, 30 days",
};

const label = (feature: string) =>
  feature.startsWith("missingindicator_")
    ? `${FEATURE_LABELS[feature.replace("missingindicator_", "")] ?? feature} (missing-value flag)`
    : (FEATURE_LABELS[feature] ?? feature);

export function mlOpinion(record: MlRecord): MlOpinion {
  const ml = record.analysis.ml_experiment;
  if (ml.model_status !== "available" || ml.predicted_probability === null) {
    return { status: ml.model_status === "not_applicable" ? "not_applicable" : "unavailable", band: null, aboveThreshold: false, drivers: [] };
  }
  const score = ml.predicted_probability;
  return {
    status: "available",
    band: ml.above_threshold ? "High" : score >= 0.5 ? "Elevated" : "Low",
    aboveThreshold: !!ml.above_threshold,
    drivers: ml.top_contributions.map((c) => ({ feature: c.feature, label: label(c.feature), contribution: c.contribution })),
  };
}
