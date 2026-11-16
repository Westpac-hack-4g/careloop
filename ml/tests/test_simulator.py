"""Accounting & simulation acceptance tests."""
from careloop import config as C
from careloop.features import compute_features, prepare
from careloop.ledger import CustomerData, Ledger, PlanBuilder, cents, reconcile
from careloop.sample_customers import all_demo_customers, demo_customer
from careloop.simulator import generate_cohort, simulate_customer


def _mini(opening=100.0, savings=None):
    accounts = [{"account_id": "A1", "customer_id": "X", "account_type": "everyday",
                 "opening_balance_cents": cents(opening), "accessible": True}]
    if savings is not None:
        accounts.append({"account_id": "A2", "customer_id": "X", "account_type": "savings",
                         "opening_balance_cents": cents(savings), "accessible": True})
    return CustomerData({"customer_id": "X", "display_name": "X", "profile_type": "full_time",
                         "data_source": "synthetic", "history_start": C.HISTORY_START.isoformat()}, accounts)


def test_reconciliation_all_demo_and_cohort_accounts():
    for d in all_demo_customers() + generate_cohort(40, seed=7):
        for acc, (expected, closing) in reconcile(d).items():
            assert expected == closing, acc
            assert closing >= 0, f"{acc} went negative (no overdraft is simulated)"


def test_failed_repayment_is_not_debited():
    d = _mini(opening=100)
    p = PlanBuilder(d, "A1", C.HISTORY_START)
    p.commitment(C.HISTORY_START, "loan", 500, "loan_repayment", loan_id="L1", description="loan")
    Ledger(d, "A1").run(p.plan)
    assert d.balance_cents("A1") == cents(100)
    assert d.repayment_outcomes[0]["status"] == "failed" and d.repayment_outcomes[0]["paid_amount_cents"] == 0
    assert d.transactions[0]["status"] == "failed"


def test_sweep_from_savings_is_internal_and_not_income():
    d = _mini(opening=100, savings=1000)
    p = PlanBuilder(d, "A1", C.HISTORY_START)
    p.commitment(C.HISTORY_START, "loan", 500, "loan_repayment", loan_id="L1", description="loan")
    Ledger(d, "A1", "A2").run(p.plan)
    assert d.repayment_outcomes[0]["status"] == "success"
    internal = [t for t in d.transactions if t["is_internal"]]
    assert len(internal) == 2 and sum(t["amount_cents"] for t in internal) == 0
    f = compute_features(prepare(d).view(C.HISTORY_START))["features"]
    assert f["net_cash_flow_30d"] == -500.0          # transfer legs excluded
    assert f["accessible_balance"] == 600.0


def test_mia_failure_arises_from_insufficient_funds():
    mia = demo_customer("MIA")
    failed = [o for o in mia.repayment_outcomes if o["status"] == "failed" and o["due_date"] <= "2026-11-16"]
    assert failed and failed[0]["due_date"] == "2026-11-10"


def test_same_seed_same_dataset_and_different_seed_differs():
    a, b = simulate_customer(5, seed=42), simulate_customer(5, seed=42)
    assert a.transactions == b.transactions and a.repayment_outcomes == b.repayment_outcomes
    c = simulate_customer(5, seed=43)
    assert a.transactions != c.transactions


def test_generator_never_assigns_tiers_or_labels():
    d = simulate_customer(3)
    blob = repr(d.customer) + repr(d.accounts)
    for forbidden in ("tier", "risk", "label", "hardship"):
        assert forbidden not in blob.lower()


def test_sarah_history_balance_is_420_on_as_of():
    s = demo_customer("SARAH")
    assert s.balance_cents("ACC-SARAH-1", C.AS_OF_DATE) == 42000
