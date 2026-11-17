"""Build past-only feature snapshots + future 14-day labels from the generated cohort.

    python scripts/build_features.py
"""
import argparse
import time

import _path  # noqa: F401
from careloop import config as C, db
from careloop.ml import FEATURE_COLUMNS, build_snapshots


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(C.SNAPSHOTS_CSV))
    args = ap.parse_args()
    t0 = time.time()
    cohort = db.load_all(data_source="synthetic")
    if not cohort:
        raise SystemExit("No synthetic cohort found. Run: python scripts/generate_data.py --customers 1000 --seed 42")
    df, stats = build_snapshots(cohort)
    df.to_csv(args.out, index=False)
    db.save_snapshots(df, FEATURE_COLUMNS)
    y = df["missed_repayment_next_14d"]
    print(f"Customers: {df['customer_id'].nunique()}  candidate snapshots: {stats['candidate_snapshots']}")
    print(f"Excluded (no repayment due in next {C.LABEL_HORIZON_DAYS} days): {stats['excluded_no_repayment_due']}")
    print(f"Labelled snapshots: {len(df)}  positives: {int(y.sum())} (prevalence {y.mean():.2%})")
    print(df.groupby("profile_type")["missed_repayment_next_14d"].agg(["size", "mean"]).round(4).to_string())
    print(f"Saved {args.out} and feature_snapshots table ({time.time() - t0:.1f}s)")


if __name__ == "__main__":
    main()
