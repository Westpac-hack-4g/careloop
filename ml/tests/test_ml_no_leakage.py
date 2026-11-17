"""Label definition, snapshot exclusion, group split and graceful ML fallback."""
from datetime import date, timedelta

import pandas as pd
import pytest

from careloop import config as C, ml
from careloop.simulator import generate_cohort


@pytest.fixture(scope="module")
def snapshots():
    df, stats = ml.build_snapshots(generate_cohort(120, seed=42))
    return df, stats


def test_label_is_one_only_for_observed_failure_in_window():
    d = generate_cohort(1, seed=1)[0]
    d.repayment_outcomes = [
        {"due_date": "2026-09-05", "status": "success"},
        {"due_date": "2026-09-20", "status": "failed"},
    ]
    t = date(2026, 9, 1)
    assert ml.label_for(d, t) == 0                     # only the success is in (t, t+14]
    assert ml.label_for(d, t + timedelta(days=7)) == 1  # failure on 09-20 is in (09-08, 09-22]
    assert ml.label_for(d, date(2026, 9, 20)) is None   # due date == t is NOT in (t, t+14]


def test_no_repayment_due_snapshots_are_excluded(snapshots):
    df, stats = snapshots
    assert stats["excluded_no_repayment_due"] > 0
    assert len(df) == stats["candidate_snapshots"] - stats["excluded_no_repayment_due"]
    assert set(df["missed_repayment_next_14d"].unique()) <= {0, 1}


def test_snapshots_have_enough_history_and_observed_future(snapshots):
    df, _ = snapshots
    t = pd.to_datetime(df["as_of_date"]).dt.date
    assert t.min() >= C.HISTORY_START + timedelta(days=C.SNAPSHOT_MIN_HISTORY_DAYS)
    assert t.max() <= C.SIM_END - timedelta(days=C.LABEL_HORIZON_DAYS)


def test_features_exclude_profile_and_forecast(snapshots):
    assert "profile_type" not in ml.FEATURE_COLUMNS
    assert "projected_shortfall_14d" not in ml.FEATURE_COLUMNS


def test_group_split_and_artifacts(snapshots, tmp_path, monkeypatch):
    df, _ = snapshots
    monkeypatch.setattr(C, "MODELS_DIR", tmp_path)
    monkeypatch.setattr(C, "MODEL_PATH", tmp_path / "m.joblib")
    monkeypatch.setattr(C, "METRICS_PATH", tmp_path / "metrics.json")
    monkeypatch.setattr(C, "FEATURE_SCHEMA_PATH", tmp_path / "schema.json")
    m = ml.train(df, seed=42)
    assert m["n_train_customers"] + m["n_test_customers"] == df["customer_id"].nunique()
    assert m["positives"] == int(df["missed_repayment_next_14d"].sum())
    for key in ("roc_auc", "average_precision", "brier", "precision", "recall", "confusion_matrix"):
        assert key in m["models"]["logistic_regression"]["test"]
    assert (tmp_path / "m.joblib").exists() and (tmp_path / "schema.json").exists()
    out = ml.predict({c: 0.0 for c in ml.FEATURE_COLUMNS}, repayment_due_in_horizon=True)
    assert out["model_status"] == "available" and 0 <= out["predicted_probability"] <= 1
    assert ml.predict({}, repayment_due_in_horizon=False)["model_status"] == "not_applicable"


def test_missing_model_gives_not_trained(tmp_path, monkeypatch):
    monkeypatch.setattr(C, "MODEL_PATH", tmp_path / "absent.joblib")
    out = ml.predict({}, repayment_due_in_horizon=True)
    assert out["model_status"] == "not_trained" and out["predicted_probability"] is None
