"""Time-safety and recompute tests for as-of features."""
import copy
from datetime import date, timedelta

from careloop import config as C
from careloop.features import compute_features, infer_cadence, prepare
from careloop.sample_customers import demo_customer
from careloop.simulator import simulate_customer

import numpy as np


def feats(d, as_of=C.AS_OF_DATE):
    return compute_features(prepare(d).view(as_of))


def test_snapshot_unchanged_when_future_transaction_modified():
    s = demo_customer("SARAH", fresh=True)
    before = feats(s)
    changed = copy.deepcopy(s)
    for t in changed.transactions:
        if t["posted_at"] > C.AS_OF_DATE.isoformat() and t["category"] == "wages":
            t["amount_cents"] *= 50          # huge future pay rise
    changed.transactions.append({**changed.transactions[-1], "transaction_id": "TX-FUT", "posted_at": "2026-11-17",
                                 "amount_cents": 9_999_900, "category": "salary", "direction": "credit",
                                 "status": "posted", "income_source_id": "INC-SARAH-1"})
    assert feats(changed) == before


def test_future_shocks_and_outcomes_are_never_read():
    d = simulate_customer(11)
    t = date(2026, 9, 1)
    before = feats(d, t)
    d2 = copy.deepcopy(d)
    d2.simulation_events = [{"event_id": "E", "customer_id": d.customer_id, "event_date": "2026-09-05",
                             "event_type": "job_loss", "parameters_json": "{}"}]
    d2.repayment_outcomes = [o | {"status": "failed"} for o in d2.repayment_outcomes]
    assert feats(d2, t) == before


def test_changing_past_transactions_recomputes_features():
    s = demo_customer("SARAH", fresh=True)
    before = feats(s)["features"]
    s.transactions = [t for t in s.transactions if not (t["category"] == "groceries" and "2026-11-01" <= t["posted_at"] <= "2026-11-16")]
    after = feats(s)["features"]
    assert after["net_cash_flow_30d"] > before["net_cash_flow_30d"]
    assert after["accessible_balance"] > before["accessible_balance"]


def test_income_change_is_relative_to_own_baseline():
    f = feats(demo_customer("SARAH"))["features"]
    # Sarah's fortnightly pay fell from ~$1,200 to $900
    assert -0.30 < f["income_change_pct"] < -0.15
    assert f["baseline_weekly_income"] > f["recent_weekly_income"]


def test_regular_fortnightly_pay_is_not_volatile():
    f = feats(demo_customer("ALEX"))["features"]
    assert f["income_volatility"] < 0.1


def test_cadence_inference():
    days = np.array([date(2026, 1, 2).toordinal() + 14 * k for k in range(8)])
    c = infer_cadence(days)
    assert c.days == 14 and c.regular


def test_missing_income_is_unknown_not_zero():
    d = simulate_customer(1)
    d.transactions = [t for t in d.transactions if t["category"] not in C.INCOME_CATEGORIES]
    b = feats(d)
    assert b["quality"]["income_visibility"] == "unknown"
    assert b["features"]["income_change_pct"] is None
    assert b["features"]["essential_expense_ratio"] is None
    assert "income_change_pct" in b["missing_flags"]


def test_cash_buffer_uses_accessible_funds():
    f = feats(demo_customer("TOM_CONTROL"))["features"]
    g = feats(demo_customer("TOM"))["features"]
    assert f["cash_buffer_days"] > 90 > g["cash_buffer_days"]
    assert f["income_volatility"] == g["income_volatility"]


def test_failed_payments_split_loan_vs_other():
    f = feats(demo_customer("MIA"))["features"]
    assert f["failed_loan_payments_30d"] == 1
    assert f["failed_other_payments_30d"] >= 1


def test_short_history_flags_insufficient():
    d = demo_customer("ALEX")
    b = compute_features(prepare(d).view(C.HISTORY_START + timedelta(days=40)))
    assert b["quality"]["data_quality"] == "insufficient"
    assert b["features"]["income_change_pct"] is None
