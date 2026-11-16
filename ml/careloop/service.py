"""Shared domain façade used by BOTH Streamlit and FastAPI.

The website must render this output; it must not recompute tiers itself.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from . import config as C
from . import db, ml
from .features import compute_features, daily_balances, prepare, weekly_income_history
from .forecast import forecast_pair
from .ledger import CustomerData, aud
from .sample_customers import BUILDERS, DEMO_ORDER, demo_customer
from .schemas import AnalysisRequest, AnalysisResponse, CustomerDetail, CustomerSummary, SupportJourney
from .tiers import assess, recommended_action

CUSTOMER_CHOICES = ["Show me why", "Talk to someone", "Not now", "This isn't right"]


class ConsentRequiredError(PermissionError):
    pass


class UnknownCustomerError(KeyError):
    pass


def get_customer_data(customer_id: str) -> CustomerData:
    cid = customer_id.upper()
    if cid in BUILDERS:
        return demo_customer(cid)
    data = db.load_customer(customer_id)
    if data is None:
        raise UnknownCustomerError(customer_id)
    return data


def _summary(d: CustomerData) -> CustomerSummary:
    c = d.customer
    return CustomerSummary(customer_id=c["customer_id"], display_name=c["display_name"],
                           profile_type=c["profile_type"], data_source=c["data_source"], story=c.get("story"))


def list_demo_customers(include_controls: bool = True) -> list[CustomerSummary]:
    ids = DEMO_ORDER + (["TOM_CONTROL"] if include_controls else [])
    return [_summary(demo_customer(i)) for i in ids]


def list_cohort_customers(limit: int = 50) -> list[CustomerSummary]:
    return [CustomerSummary(**r, story=None) for r in db.list_customers(data_source="synthetic", limit=limit)]


def _validate_as_of(data: CustomerData, as_of: date | None) -> date:
    as_of = as_of or C.AS_OF_DATE
    start = date.fromisoformat(data.customer["history_start"])
    if not (start + timedelta(days=28) <= as_of <= C.SIM_END - timedelta(days=C.LOOKAHEAD_DAYS)):
        raise ValueError(f"as_of_date must be between {start + timedelta(days=28)} and "
                         f"{C.SIM_END - timedelta(days=C.LOOKAHEAD_DAYS)}")
    return as_of


def analyse_data(data: CustomerData, as_of: date | None = None, *, consent: bool = True,
                 specialist_disclosed: bool = False,
                 customer_confirmed_income: list[dict[str, Any]] | None = None) -> AnalysisResponse:
    if not consent:
        raise ConsentRequiredError("consent_required")
    as_of = _validate_as_of(data, as_of)
    view = prepare(data).view(as_of)                 # hard as-of cut-off
    bundle = compute_features(view, customer_confirmed_income)
    fc = forecast_pair(view, C.LOOKAHEAD_DAYS, customer_confirmed_income)
    assessment = assess(bundle, fc, specialist_disclosed)
    feats = dict(bundle["features"])
    feats["projected_shortfall_14d"] = fc["base"]["shortfall_amount_aud"]
    feats["projected_shortfall_14d_conservative"] = fc["conservative"]["shortfall_amount_aud"]

    due = any(e["event_type"] in ("loan_repayment", "card_repayment") for e in fc["base"]["events"])
    ml_out = ml.predict(feats, repayment_due_in_horizon=due)
    action = recommended_action(assessment)
    forecast = dict(fc["base"]) | {"conservative": fc["conservative"], "confidence": fc["confidence"],
                                   "confidence_reasons": fc["confidence_reasons"],
                                   "shortfall_range_aud": fc["shortfall_range_aud"]}
    return AnalysisResponse(
        customer_id=data.customer_id, display_name=data.customer["display_name"], as_of_date=as_of.isoformat(),
        data_source=data.customer["data_source"], consent_confirmed=True,
        assessment_status=assessment["assessment_status"], financial_tier=assessment["financial_tier"],
        tier_label=assessment["tier_label"], specialist_support_required=assessment["specialist_support_required"],
        specialist_label=C.SPECIALIST_LABEL if assessment["specialist_support_required"] else None,
        alerts_paused=assessment["alerts_paused"], rule_applied=assessment["rule_applied"],
        reason_codes=assessment["reason_codes"], reasons=assessment["reasons"],
        warning_signals=assessment["warning_signals"], features=feats, missing_flags=bundle["missing_flags"],
        data_quality=bundle["quality"], income_streams=bundle["income_streams"], forecast=forecast,
        ml_experiment=ml_out, recommended_action=action,
        support_journey=SupportJourney(
            recommended_action=action, customer_choices=CUSTOMER_CHOICES,
            alerts_paused=assessment["alerts_paused"],
            specialist_handover_available=True,
            response_time_policy_days=C.SUPPORT_REQUEST_RESPONSE_DAYS_POLICY,
            response_time_note="Configurable, unverified demo setting - not legal advice."),
        feature_version=bundle["feature_version"], disclaimer=C.DEMO_NOTICE)


def analyse(request: AnalysisRequest) -> AnalysisResponse:
    if not request.consent_confirmed:
        raise ConsentRequiredError("consent_required")
    data = get_customer_data(request.customer_id)
    confirmed = [c.model_dump(mode="json") for c in request.customer_confirmed_income] \
        if request.customer_confirmed_income else None
    return analyse_data(data, request.as_of_date, consent=True,
                        specialist_disclosed=request.customer_disclosed_specialist_need,
                        customer_confirmed_income=confirmed)


def customer_detail(customer_id: str, as_of: date | None = None, days: int = 45) -> CustomerDetail:
    data = get_customer_data(customer_id)
    as_of = _validate_as_of(data, as_of)
    lo = (as_of - timedelta(days=days)).isoformat()
    txs = [t for t in data.transactions if lo < t["posted_at"] <= as_of.isoformat()]
    txs.sort(key=lambda t: (t["posted_at"], t["transaction_id"]), reverse=True)
    upcoming = [e for e in data.scheduled_events
                if e["known_at"] <= as_of.isoformat() < e["due_date"] <= (as_of + timedelta(days=30)).isoformat()]
    s = _summary(data)
    return CustomerDetail(
        **s.model_dump(), as_of_date=as_of.isoformat(),
        accounts=[{"account_id": a["account_id"], "account_type": a["account_type"],
                   "balance_aud": aud(data.balance_cents(a["account_id"], as_of))} for a in data.accounts],
        recent_transactions=[{**{k: t[k] for k in ("transaction_id", "account_id", "posted_at", "category",
                                                   "direction", "status", "counterparty_type", "income_source_id",
                                                   "description")}, "amount": aud(t["amount_cents"])} for t in txs],
        known_upcoming_events=[{"due_date": e["due_date"], "description": e["description"],
                                "event_type": e["event_type"], "amount_aud": aud(e["amount_cents"]),
                                "amount_status": e["amount_status"]} for e in sorted(upcoming, key=lambda e: e["due_date"])])


def history_for_charts(data: CustomerData, as_of: date | None = None) -> dict[str, list[dict[str, Any]]]:
    """Past-only daily balance and weekly income series for charts."""
    as_of = as_of or C.AS_OF_DATE
    view = prepare(data).view(as_of)
    eod = daily_balances(view)
    start = view.history_start
    balances = [{"date": (start + timedelta(days=i)).isoformat(), "balance": round(float(b), 2)}
                for i, b in enumerate(eod)]
    return {"daily_balances": balances, "weekly_income": weekly_income_history(view)}


def model_metrics() -> dict[str, Any]:
    m = ml.load_metrics()
    if m is None:
        return {"model_status": "not_trained", "message": "Experimental ML model not available.",
                "disclaimer": C.SYNTHETIC_DISCLAIMER, "data_source": "synthetic"}
    return {"model_status": "available", "data_source": "synthetic"} | m
