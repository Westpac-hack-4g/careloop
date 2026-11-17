"""Train the experimental synthetic repayment-failure model (grouped by customer).

    python scripts/train_model.py
"""
import argparse
import json

import pandas as pd

import _path  # noqa: F401
from careloop import config as C, db
from careloop.ml import train


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--snapshots", default=str(C.SNAPSHOTS_CSV))
    ap.add_argument("--seed", type=int, default=C.DEFAULT_SEED)
    args = ap.parse_args()
    try:
        df = pd.read_csv(args.snapshots)
    except FileNotFoundError:
        raise SystemExit("Snapshots not found. Run scripts/generate_data.py then scripts/build_features.py")
    m = train(df, seed=args.seed, generator=db.read_meta().get("generator", {}))
    print("SYNTHETIC EXPERIMENT -", C.SYNTHETIC_DISCLAIMER, "\n")
    print(f"customers {m['n_customers']} (train {m['n_train_customers']} / test {m['n_test_customers']}), "
          f"snapshots {m['n_snapshots']}, positives {m['positives']} (prevalence {m['prevalence']:.2%})")
    for name, r in m["models"].items():
        t = r["test"]
        print(f"  {name:<24} ROC-AUC {t['roc_auc']}  PR-AUC {t['average_precision']}  Brier {t['brier']}  "
              f"precision {t['precision']}  recall {t['recall']} @thr {t['threshold']}  CM {t['confusion_matrix']}")
    print("Per-profile (LR, held-out, simulation only):")
    print(json.dumps(m["per_profile_test_lr"], indent=1))
    if "warning" in m:
        print("WARNING:", m["warning"])
    print(f"Saved {C.MODEL_PATH.name}, {C.METRICS_PATH.name}, {C.FEATURE_SCHEMA_PATH.name} in {C.MODELS_DIR}")


if __name__ == "__main__":
    main()
