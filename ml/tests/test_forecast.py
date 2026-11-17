"""Forecast arithmetic and recompute tests, focused on Sarah's $620 demo."""
from datetime import date

from careloop import config as C
from careloop.features import prepare
from careloop.forecast import forecast_pair, project
from careloop.sample_customers import build_sarah, demo_customer


def base(d, **kw):
    return project(prepare(d).view(C.AS_OF_DATE), "base", **kw)


def test_sarah_620_on_28_nov_arithmetic():
    fc = base(demo_customer("SARAH"))
    assert fc["start_balance_aud"] == 420.0
    income = sum(e["amount_aud"] for e in fc["events"] if e["event_type"] == "income" and e["date"] < "2026-11-28")
    bills = sum(e["amount_aud"] for e in fc["events"] if e["event_type"] == "bill" and e["date"] < "2026-11-28")
    loan = [e for e in fc["events"] if e["event_type"] == "loan_repayment"]
    assert income == 900.0 and bills == -940.0
    assert loan[0]["date"] == "2026-11-28" and loan[0]["amount_aud"] == -1000.0
    assert 420 + income + bills - 1000 == -620
    assert fc["shortfall_amount_aud"] == 620.0 and fc["shortfall_date"] == "2026-11-28"
    assert fc["planned_repayment_aud"] == 1000.0
    assert len(fc["daily_balances"]) == 14


def test_sarah_income_is_estimated_not_oracle():
    fc = base(demo_customer("SARAH"))
    pay = [e for e in fc["events"] if e["event_type"] == "income"][0]
    assert pay["basis"].startswith("estimated")


def test_changing_inputs_recomputes_shortfall():
    assert base(build_sarah(balance_as_of=520.0))["shortfall_amount_aud"] == 520.0
    assert base(build_sarah(balance_as_of=1500.0))["shortfall_amount_aud"] == 0.0
    confirmed = [{"date": "2026-11-20", "amount": 1200}]
    fc = base(demo_customer("SARAH"), customer_confirmed=confirmed)
    assert fc["shortfall_amount_aud"] == 320.0


def test_conservative_is_not_better_than_base():
    for cid in ("ALEX", "TOM", "SARAH", "MIA"):
        p = forecast_pair(prepare(demo_customer(cid)).view(C.AS_OF_DATE))
        assert p["conservative"]["shortfall_amount_aud"] >= p["base"]["shortfall_amount_aud"]
        assert p["conservative"]["lowest_balance_aud"] <= p["base"]["lowest_balance_aud"]


def test_tom_has_no_near_term_gap():
    p = forecast_pair(prepare(demo_customer("TOM")).view(C.AS_OF_DATE))
    assert p["base"]["shortfall_amount_aud"] == 0.0


def test_negative_balance_only_counts_on_repayment_dates():
    fc = base(demo_customer("SARAH"))
    # balance is positive until the loan date, so the only shortfall date is the loan date
    neg_days = [b["date"] for b in fc["daily_balances"] if b["balance"] < 0]
    assert neg_days[0] == "2026-11-28"


def test_forecast_uses_only_known_scheduled_events():
    s = demo_customer("SARAH")
    rego = [e for e in s.scheduled_events if "registration" in e["description"]][0]
    assert rego["known_at"] == "2026-10-26"
    early = project(prepare(s).view(date(2026, 10, 20)), "base", horizon=14)
    assert not any("registration" in e["description"] for e in early["events"])
