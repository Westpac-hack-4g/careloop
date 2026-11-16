"""Rules engine: demo outcomes and fairness / common-sense controls."""
import copy

from careloop import config as C
from careloop.ledger import CustomerData, Ledger, PlanBuilder, cents
from careloop.sample_customers import demo_customer, every, monthly, weekday_dates
from careloop.service import analyse_data
from careloop.simulator import simulate_customer
from careloop.tiers import assess

import numpy as np


def run(cid, **kw):
    return analyse_data(demo_customer(cid), **kw)


def test_demo_tiers():
    assert [run(c).financial_tier for c in ("ALEX", "TOM", "SARAH", "MIA")] == [0, 1, 2, 3]


def test_sarah_tier2_with_620_gap():
    r = run("SARAH")
    assert r.financial_tier == 2 and "EXPECTED_REPAYMENT_GAP" in r.reason_codes
    assert r.forecast.shortfall_amount_aud == 620.0 and r.forecast.shortfall_date == "2026-11-28"


def test_tom_tier1_without_gap():
    r = run("TOM")
    assert r.financial_tier == 1 and r.forecast.shortfall_amount_aud == 0
    assert len(r.warning_signals) >= 2


def test_mia_tier3_from_past_failed_repayment():
    r = run("MIA")
    assert r.financial_tier == 3 and "MISSED_REPAYMENT" in r.reason_codes


def test_well_funded_casual_worker_stays_tier0():
    r = run("TOM_CONTROL")
    assert r.financial_tier == 0
    assert r.features["income_volatility"] == run("TOM").features["income_volatility"]


def _salaried_with_gap() -> CustomerData:
    """Stable monthly salary, but a big known repayment just before payday."""
    cid = "SAL"
    d = CustomerData({"customer_id": cid, "display_name": "Sal", "profile_type": "full_time",
                      "data_source": "synthetic", "history_start": C.HISTORY_START.isoformat()},
                     [{"account_id": "S1", "customer_id": cid, "account_type": "everyday",
                       "opening_balance_cents": cents(3000), "accessible": True}],
                     income_sources=[])
    p = PlanBuilder(d, "S1", C.HISTORY_START)
    for day in monthly(1):
        p.add(day, "income", 5000, "salary", income_source_id="INC-SAL-1", description="Salary")
    for day in monthly(3):
        p.commitment(day, "essential", 2000, "rent", description="Rent")
    for day in weekday_dates(5):
        p.add(day, "essential", 150, "groceries", description="Groceries")
    for day in monthly(20):
        p.commitment(day, "loan", 1500, "loan_repayment", loan_id="L", description="Loan")
    from datetime import date
    p.commitment(date(2026, 11, 25), "loan", 12000, "loan_repayment", loan_id="BAL", known_at=date(2026, 11, 1),
                 description="Balloon payment on car loan")
    Ledger(d, "S1").run(p.plan)
    return d


def test_stable_salaried_worker_with_credible_gap_is_tier2():
    r = analyse_data(_salaried_with_gap())
    assert r.income_streams[0].regular
    assert r.financial_tier == 2


def test_volatility_alone_does_not_raise_tier():
    bundle = {"features": {"income_volatility": 2.5, "income_regular": False, "cash_buffer_days": 200,
                           "net_cash_flow_30d": 500, "repayment_coverage_ratio": 3.0, "failed_loan_payments_30d": 0,
                           "failed_other_payments_30d": 0, "income_change_pct": 0.1},
              "quality": {"data_quality": "sufficient", "income_visibility": "adequate"}}
    fc = {"base": {"shortfall_amount_aud": 0.0}, "conservative": {"shortfall_amount_aud": 0.0}}
    a = assess(bundle, fc)
    assert a["financial_tier"] == 0
    assert "VARIABLE_INCOME_NOTED" in a["reason_codes"] and not a["warning_signals"]


def test_missing_salary_gives_insufficient_data_not_a_tier():
    d = simulate_customer(2)
    d.transactions = [t for t in d.transactions if t["category"] not in C.INCOME_CATEGORIES]
    d.repayment_outcomes = []
    d.transactions = [t for t in d.transactions if not (t["status"] == "failed" and t["category"] in C.REPAYMENT_CATEGORIES)]
    r = analyse_data(d)
    assert r.assessment_status == "insufficient_data" and r.financial_tier is None
    assert "PARTIAL_INCOME_VISIBILITY" in r.reason_codes


def test_specialist_route_only_from_disclosure():
    plain = run("ALEX")
    assert not plain.specialist_support_required
    r = run("ALEX", specialist_disclosed=True)
    assert r.specialist_support_required and r.alerts_paused
    assert r.financial_tier == 0          # financial tier is separate from specialist routing
    assert "specialist" in r.recommended_action.lower()


def test_specialist_never_inferred_from_spending_categories():
    d = demo_customer("TOM", fresh=True)
    for t in d.transactions:
        if t["category"] == "entertainment":
            t["description"] = "Counselling service / gambling / pharmacy"   # merchant text is ignored
    assert not analyse_data(d).specialist_support_required


def test_ml_does_not_change_tier(monkeypatch):
    from careloop import ml
    monkeypatch.setattr(ml, "predict", lambda f, repayment_due_in_horizon: {
        "model_status": "available", "predicted_probability": 0.99, "description": "x", "disclaimer": "x"})
    assert run("ALEX").financial_tier == 0
