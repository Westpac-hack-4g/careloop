"""Experimental ML: predict simulated repayment failure in (t, t+14].

* X(t) = as-of features from ``features.compute_features`` (past-only view).
* y(t) = 1 if the simulator recorded an actual failed loan/card repayment due in
  (t, t+14]; 0 if repayments were due and all succeeded. Snapshots with no
  repayment due in the horizon are EXCLUDED.
* Train/test split is grouped by customer_id; preprocessing lives inside each
  pipeline; the decision threshold is chosen on out-of-fold TRAINING predictions.

The model describes the SIMULATOR, not real customers. It never sets a tier.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any, Iterable

import joblib
import numpy as np
import pandas as pd
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (average_precision_score, brier_score_loss, confusion_matrix, f1_score,
                             precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import GroupKFold, GroupShuffleSplit, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from . import config as C
from .features import compute_features, prepare
from .ledger import CustomerData

FEATURE_COLUMNS = [
    "income_change_pct", "income_volatility", "net_cash_flow_30d", "cash_buffer_days",
    "repayment_coverage_ratio", "failed_loan_payments_30d", "failed_other_payments_30d",
    "balance_change_30d", "essential_expense_ratio", "income_gap_ratio",
]
# Deterministic clipping (not fitted on data, so no leakage) to tame extreme ratios.
CLIP = {"income_change_pct": (-1, 3), "income_volatility": (0, 5), "net_cash_flow_30d": (-20000, 20000),
        "cash_buffer_days": (0, 365), "repayment_coverage_ratio": (0, 10), "failed_loan_payments_30d": (0, 5),
        "failed_other_payments_30d": (0, 20), "balance_change_30d": (-5, 5), "essential_expense_ratio": (0, 5),
        "income_gap_ratio": (0, 10)}


# ====================================================================== snapshots
def label_for(data: CustomerData, t: date, horizon: int = C.LABEL_HORIZON_DAYS) -> int | None:
    """Realised future outcome. None = no repayment due -> exclude snapshot."""
    lo, hi = t.isoformat(), (t + timedelta(days=horizon)).isoformat()
    due = [o for o in data.repayment_outcomes if lo < o["due_date"] <= hi]
    if not due:
        return None
    return int(any(o["status"] == "failed" for o in due))


def snapshot_dates(data: CustomerData, sim_end: date = C.SIM_END) -> list[date]:
    start = date.fromisoformat(data.customer["history_start"])
    t = start + timedelta(days=C.SNAPSHOT_MIN_HISTORY_DAYS)
    last = sim_end - timedelta(days=C.LABEL_HORIZON_DAYS)
    out = []
    while t <= last:
        out.append(t)
        t += timedelta(days=C.SNAPSHOT_STEP_DAYS)
    return out


def build_snapshots(customers: Iterable[CustomerData], sim_end: date = C.SIM_END) -> tuple[pd.DataFrame, dict]:
    rows, stats = [], {"candidate_snapshots": 0, "excluded_no_repayment_due": 0}
    for data in customers:
        prep = prepare(data)
        for t in snapshot_dates(data, sim_end):
            stats["candidate_snapshots"] += 1
            y = label_for(data, t)
            if y is None:
                stats["excluded_no_repayment_due"] += 1
                continue
            b = compute_features(prep.view(t))     # past-only view
            f = b["features"]
            row = {"customer_id": data.customer_id, "as_of_date": t.isoformat(),
                   "profile_type": data.customer["profile_type"],     # for fairness reporting only
                   "income_visibility": b["quality"]["income_visibility"],
                   "missing_flags": json.dumps(b["missing_flags"]), "feature_version": C.FEATURE_VERSION,
                   "missed_repayment_next_14d": y}
            row.update({c: f.get(c) for c in FEATURE_COLUMNS})
            rows.append(row)
    df = pd.DataFrame(rows)
    return df, stats


def _X(df: pd.DataFrame) -> pd.DataFrame:
    X = df[FEATURE_COLUMNS].astype(float).copy()
    for c, (lo, hi) in CLIP.items():
        X[c] = X[c].clip(lo, hi)
    return X


def make_models(seed: int = C.DEFAULT_SEED) -> dict[str, Any]:
    return {
        "baseline_prevalence": DummyClassifier(strategy="prior"),
        "logistic_regression": Pipeline([
            ("impute", SimpleImputer(strategy="median", add_indicator=True)),
            ("scale", StandardScaler()),
            ("model", LogisticRegression(max_iter=2000, class_weight="balanced", random_state=seed)),
        ]),
        "hist_gradient_boosting": HistGradientBoostingClassifier(max_iter=200, learning_rate=0.06, max_depth=4,
                                                                 class_weight="balanced", random_state=seed),
    }


def _metrics(y, p, thr) -> dict[str, Any]:
    pred = (p >= thr).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    out = {"threshold": round(float(thr), 4),
           "roc_auc": round(float(roc_auc_score(y, p)), 4) if len(set(y)) > 1 else None,
           "average_precision": round(float(average_precision_score(y, p)), 4) if len(set(y)) > 1 else None,
           "brier": round(float(brier_score_loss(y, p)), 4),
           "precision": round(float(precision_score(y, pred, zero_division=0)), 4),
           "recall": round(float(recall_score(y, pred, zero_division=0)), 4),
           "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)}}
    return out


def _choose_threshold(y, p_oof) -> float:
    grid = np.unique(np.quantile(p_oof, np.linspace(0.5, 0.995, 120)))
    scores = [f1_score(y, (p_oof >= g).astype(int), zero_division=0) for g in grid]
    return float(grid[int(np.argmax(scores))])


def train(df: pd.DataFrame, seed: int = C.DEFAULT_SEED, generator: dict | None = None) -> dict[str, Any]:
    df = df.reset_index(drop=True)
    y = df["missed_repayment_next_14d"].astype(int).to_numpy()
    groups = df["customer_id"].to_numpy()
    X = _X(df)
    gss = GroupShuffleSplit(n_splits=1, test_size=C.TEST_SIZE, random_state=seed)
    tr, te = next(gss.split(X, y, groups))
    assert not set(groups[tr]) & set(groups[te]), "customer leakage between train and test"
    results, fitted = {}, {}
    cv = GroupKFold(n_splits=5)
    for name, model in make_models(seed).items():
        oof = cross_val_predict(model, X.iloc[tr], y[tr], groups=groups[tr], cv=cv, method="predict_proba")[:, 1]
        thr = _choose_threshold(y[tr], oof) if name != "baseline_prevalence" else 0.5
        model.fit(X.iloc[tr], y[tr])
        p_te = model.predict_proba(X.iloc[te])[:, 1]
        results[name] = {"test": _metrics(y[te], p_te, thr),
                         "train_cv_average_precision": round(float(average_precision_score(y[tr], oof)), 4)}
        fitted[name] = (model, thr, p_te)

    lr, lr_thr, lr_p = fitted["logistic_regression"]
    # per-profile false-positive rate (simulation only - NOT a real-world fairness result)
    test_df = df.iloc[te].assign(_p=lr_p, _pred=(lr_p >= lr_thr).astype(int))
    fairness = {}
    for prof, g in test_df.groupby("profile_type"):
        neg = g[g["missed_repayment_next_14d"] == 0]
        pos = g[g["missed_repayment_next_14d"] == 1]
        fairness[prof] = {"snapshots": int(len(g)), "prevalence": round(float(g["missed_repayment_next_14d"].mean()), 4),
                          "false_positive_rate": round(float(neg["_pred"].mean()), 4) if len(neg) else None,
                          "recall": round(float(pos["_pred"].mean()), 4) if len(pos) else None}
    coefs = lr.named_steps["model"].coef_[0]
    names = list(lr.named_steps["impute"].get_feature_names_out(FEATURE_COLUMNS))
    coef_table = sorted([{"feature": n, "standardised_coefficient": round(float(c), 4)} for n, c in zip(names, coefs)],
                        key=lambda r: -abs(r["standardised_coefficient"]))
    metrics = {
        "model_version": C.MODEL_VERSION, "feature_version": C.FEATURE_VERSION,
        "target": "missed_repayment_next_14d (simulated loan/card repayment failure in (t, t+14])",
        "selected_model": "logistic_regression",
        "seed": seed, "generator": generator or {},
        "n_customers": int(df["customer_id"].nunique()),
        "n_train_customers": int(len(set(groups[tr]))), "n_test_customers": int(len(set(groups[te]))),
        "n_snapshots": int(len(df)), "n_train_snapshots": int(len(tr)), "n_test_snapshots": int(len(te)),
        "positives": int(y.sum()), "prevalence": round(float(y.mean()), 4),
        "train_prevalence": round(float(y[tr].mean()), 4), "test_prevalence": round(float(y[te].mean()), 4),
        "threshold_selection": "max F1 on 5-fold GroupKFold out-of-fold predictions within TRAINING customers",
        "models": results, "per_profile_test_lr": fairness, "lr_coefficients": coef_table,
        "calibration_note": "class_weight='balanced' inflates probabilities relative to prevalence; treat the "
                            "score as a ranking, not a calibrated probability.",
        "disclaimer": C.SYNTHETIC_DISCLAIMER,
    }
    if results["logistic_regression"]["test"]["roc_auc"] and results["logistic_regression"]["test"]["roc_auc"] > 0.98:
        metrics["warning"] = "Very high AUC - check for leakage or simulator shortcuts."
    C.MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"pipeline": lr, "threshold": lr_thr, "features": FEATURE_COLUMNS, "clip": CLIP,
                 "model_version": C.MODEL_VERSION, "feature_version": C.FEATURE_VERSION, "seed": seed,
                 "generator": generator or {}}, C.MODEL_PATH)
    C.METRICS_PATH.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    C.FEATURE_SCHEMA_PATH.write_text(json.dumps({
        "feature_version": C.FEATURE_VERSION, "features": FEATURE_COLUMNS, "clip": CLIP,
        "excluded": ["projected_shortfall_14d (derived forecast output)", "profile_type / income_pattern_type",
                     "display_name", "any simulation_event"],
        "target": metrics["target"]}, indent=2), encoding="utf-8")
    return metrics


# ====================================================================== inference
_bundle_cache: dict[str, Any] = {}


def load_bundle() -> dict[str, Any] | None:
    if not C.MODEL_PATH.is_file():
        return None
    mtime = C.MODEL_PATH.stat().st_mtime
    if _bundle_cache.get("mtime") != mtime:
        _bundle_cache.update(mtime=mtime, bundle=joblib.load(C.MODEL_PATH))  # only our own artifact
    return _bundle_cache["bundle"]


def load_metrics() -> dict[str, Any] | None:
    if not C.METRICS_PATH.is_file():
        return None
    return json.loads(C.METRICS_PATH.read_text(encoding="utf-8"))


def predict(features: dict[str, Any], repayment_due_in_horizon: bool) -> dict[str, Any]:
    base = {"description": "Synthetic research model only - shown separately, never sets the support tier.",
            "disclaimer": C.SYNTHETIC_DISCLAIMER, "predicted_probability": None, "model_version": None,
            "threshold": None, "above_threshold": None, "top_contributions": []}
    bundle = load_bundle()
    if bundle is None:
        return base | {"model_status": "not_trained",
                       "message": "Experimental ML model not available. Run scripts/train_model.py."}
    if bundle.get("feature_version") != C.FEATURE_VERSION:
        return base | {"model_status": "incompatible", "message": "Model was trained on a different feature version."}
    if not repayment_due_in_horizon:
        return base | {"model_status": "not_applicable", "model_version": bundle["model_version"],
                       "message": "No loan/card repayment is due in the next 14 days; the model is conditional "
                                  "on a repayment being due."}
    X = _X(pd.DataFrame([{c: features.get(c) for c in FEATURE_COLUMNS}]))
    pipe = bundle["pipeline"]
    prob = float(pipe.predict_proba(X)[0, 1])
    z = pipe.named_steps["scale"].transform(pipe.named_steps["impute"].transform(X))[0]
    names = pipe.named_steps["impute"].get_feature_names_out(FEATURE_COLUMNS)
    contrib = sorted(zip(names, z * pipe.named_steps["model"].coef_[0]), key=lambda kv: -abs(kv[1]))[:4]
    return base | {"model_status": "available", "predicted_probability": round(prob, 4),
                   "model_version": bundle["model_version"], "threshold": round(float(bundle["threshold"]), 4),
                   "above_threshold": bool(prob >= bundle["threshold"]),
                   "top_contributions": [{"feature": n, "contribution": round(float(v), 3)} for n, v in contrib]}
