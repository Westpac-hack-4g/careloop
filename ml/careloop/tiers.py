"""Deterministic, auditable support-tier rules (fictional customers only).

financial_tier is 0..3. Specialist support ("Tier 4 - Needs special care" in the
proposal) is a SEPARATE routing flag set only by an explicit customer disclosure;
it is never inferred from transactions and is not a higher risk score.

income_volatility and employment / income-pattern type can never raise a tier.
The ML experiment is NOT an input here.
"""
from __future__ import annotations

from typing import Any

from . import config as C

REASON_TEXT = {
    "SPECIALIST_DISCLOSURE": "You told us about a situation where a specialist team can help.",
    "MISSED_REPAYMENT": "A loan or card repayment was unsuccessful in the last 30 days.",
    "EXPECTED_REPAYMENT_GAP": "Based on known bills and expected income, an upcoming repayment may not be fully covered.",
    "STRESS_SCENARIO_GAP": "If income comes in lower than usual, an upcoming repayment might not be covered (uncertain).",
    "LOW_BUFFER": "Your available money covers fewer than {days} days of essential costs.",
    "NEGATIVE_CASHFLOW": "More money went out than came in over the last 30 days.",
    "LOW_COVERAGE": "Expected income for the next 30 days is close to or below your known bills and repayments.",
    "BALANCE_DECLINE": "Your average balance has fallen noticeably compared with last month.",
    "INCOME_DROP": "Recent income is well below your own usual level.",
    "INCOME_OVERDUE": "An expected income payment is later than your usual pattern.",
    "FAILED_OTHER_PAYMENTS": "Another automatic payment was unsuccessful in the last 30 days.",
    "PARTIAL_INCOME_VISIBILITY": "We can't see enough of your income in this account to assess it reliably.",
    "INSUFFICIENT_HISTORY": "There isn't enough account history yet for a reliable assessment.",
    "RESERVES_COVER_DEFICIT": "Recent spending exceeded income, but your accessible savings comfortably cover essentials.",
    "VARIABLE_INCOME_NOTED": "Your income varies from pay to pay. This widens forecast uncertainty but is not itself a concern.",
}

WARNING_SIGNALS = ["LOW_BUFFER", "NEGATIVE_CASHFLOW", "LOW_COVERAGE", "BALANCE_DECLINE", "INCOME_DROP",
                   "INCOME_OVERDUE", "FAILED_OTHER_PAYMENTS", "STRESS_SCENARIO_GAP"]
FLOW_SIGNALS = {"NEGATIVE_CASHFLOW", "LOW_COVERAGE", "BALANCE_DECLINE"}


def early_warning_signals(f: dict[str, Any], forecast: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Return (counted warning signals, informational codes)."""
    signals, info = [], []
    buf = f.get("cash_buffer_days")
    if buf is not None and buf < C.WARNING_BUFFER_DAYS:
        signals.append("LOW_BUFFER")
    if f.get("net_cash_flow_30d") is not None and f["net_cash_flow_30d"] < 0:
        signals.append("NEGATIVE_CASHFLOW")
    cov = f.get("repayment_coverage_ratio")
    if cov is not None and cov < C.LOW_COVERAGE_RATIO:
        signals.append("LOW_COVERAGE")
    bc, bca = f.get("balance_change_30d"), f.get("balance_change_30d_aud")
    if bc is not None and bca is not None and bc <= C.BALANCE_DECLINE_PCT and bca <= -C.BALANCE_DECLINE_MIN_AUD:
        signals.append("BALANCE_DECLINE")
    ic = f.get("income_change_pct")
    if ic is not None and ic <= C.INCOME_DROP_THRESHOLD:
        signals.append("INCOME_DROP")
    gr = f.get("income_gap_ratio")
    if gr is not None and gr > C.INCOME_OVERDUE_RATIO and (f.get("income_gap_days") or 0) > 3:
        signals.append("INCOME_OVERDUE")
    if f.get("failed_other_payments_30d", 0) > 0:
        signals.append("FAILED_OTHER_PAYMENTS")
    if forecast["base"]["shortfall_amount_aud"] <= 0 and forecast["conservative"]["shortfall_amount_aud"] > 0:
        signals.append("STRESS_SCENARIO_GAP")
    # Ample accessible reserves neutralise flow-based signals (demo setting).
    if buf is not None and buf >= C.AMPLE_BUFFER_DAYS and any(s in FLOW_SIGNALS for s in signals):
        signals = [s for s in signals if s not in FLOW_SIGNALS]
        info.append("RESERVES_COVER_DEFICIT")
    explained = {"INCOME_DROP", "INCOME_OVERDUE"} & set(signals)   # volatility caused by an income loss
    if not explained and (f.get("income_regular") is False or (f.get("income_volatility") or 0) > 0.25):
        info.append("VARIABLE_INCOME_NOTED")   # informational only: never counted
    return signals, info


def assess(bundle: dict[str, Any], forecast: dict[str, Any], specialist_disclosed: bool = False) -> dict[str, Any]:
    f, q = bundle["features"], bundle["quality"]
    signals, info = early_warning_signals(f, forecast)
    base_gap = forecast["base"]["shortfall_amount_aud"]
    out: dict[str, Any] = {"assessment_status": "complete", "financial_tier": None, "tier_label": None,
                           "specialist_support_required": False, "alerts_paused": False,
                           "warning_signals": signals, "rule_applied": None}
    codes: list[str] = []

    if specialist_disclosed:
        out.update(specialist_support_required=True, alerts_paused=True)
        codes.append("SPECIALIST_DISCLOSURE")

    if f.get("failed_loan_payments_30d", 0) > 0:
        tier, rule = 3, "Observed failed loan/card repayment in the last 30 days"
        codes.append("MISSED_REPAYMENT")
    elif q["data_quality"] == "insufficient" or q["income_visibility"] in ("unknown", "partial"):
        tier, rule = None, "Insufficient data - ask the customer to confirm income"
        out["assessment_status"] = "insufficient_data"
        codes.append("PARTIAL_INCOME_VISIBILITY" if q["income_visibility"] in ("unknown", "partial")
                     else "INSUFFICIENT_HISTORY")
    elif base_gap > 0:
        tier, rule = 2, "Base-case repayment shortfall within 14 days"
        codes.append("EXPECTED_REPAYMENT_GAP")
    elif len(signals) >= C.MIN_WARNING_SIGNALS_FOR_TIER1:
        tier, rule = 1, f"{len(signals)} independent early-warning signals"
    else:
        tier, rule = 0, "No repayment gap and fewer than two early-warning signals"

    for s in signals:
        if s not in codes:
            codes.append(s)
    codes.extend(c for c in info if c not in codes)
    out["financial_tier"] = tier
    out["tier_label"] = C.TIER_LABELS.get(tier) if tier is not None else "Assessment needs your confirmation"
    out["rule_applied"] = rule
    out["reason_codes"] = codes
    out["reasons"] = [{"code": c, "text": REASON_TEXT[c].format(days=C.WARNING_BUFFER_DAYS)} for c in codes]
    return out


def recommended_action(assessment: dict[str, Any]) -> str:
    if assessment["specialist_support_required"]:
        return ("Pause automated heads-ups and offer a private handover to the specialist support team. "
                "No financial profiling is used for this route.")
    tier = assessment["financial_tier"]
    if assessment["assessment_status"] == "insufficient_data":
        return "Ask the customer to confirm their income (manual entry) before any assessment is shown."
    return {
        0: "No unsolicited alert. The customer can still ask for help at any time.",
        1: "Offer an optional, discreet money check-in (only if the customer opted in to heads-ups).",
        2: "Offer a private, optional conversation about repayment assistance before the due date.",
        3: "Offer an immediate, easy option to contact the assistance team. Staff decide any arrangement.",
    }[tier]
