"""Generate the synthetic cohort + demo customers into data/careloop.db.

    python scripts/generate_data.py --customers 1000 --seed 42
"""
import argparse
import time

import _path  # noqa: F401
from careloop import config as C, db
from careloop.ledger import reconcile
from careloop.sample_customers import all_demo_customers
from careloop.simulator import generate_cohort, generator_info


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--customers", type=int, default=C.DEFAULT_COHORT_SIZE)
    ap.add_argument("--seed", type=int, default=C.DEFAULT_SEED)
    args = ap.parse_args()
    info = generator_info(args.customers, args.seed)
    print("CareLoop synthetic generator")
    for k, v in info.items():
        print(f"  {k}: {v}")
    t0 = time.time()
    cohort = generate_cohort(args.customers, args.seed)
    demos = all_demo_customers()
    for d in cohort + demos:
        for acc, (expected, closing) in reconcile(d).items():
            assert expected == closing, f"reconciliation failed for {acc}"
    db.reset()
    db.save_customers(demos + cohort, meta={"generator": info})
    n_tx = sum(len(d.transactions) for d in cohort)
    n_fail = sum(o["status"] == "failed" for d in cohort for o in d.repayment_outcomes)
    n_rep = sum(len(d.repayment_outcomes) for d in cohort)
    print(f"Wrote {len(cohort)} synthetic + {len(demos)} demo customers to {C.DB_PATH}")
    print(f"  transactions: {n_tx:,}; repayment attempts: {n_rep:,}; failed: {n_fail:,} "
          f"({n_fail / max(n_rep, 1):.1%}) - realised simulation outcomes, not assigned labels")
    print(f"  all accounts reconcile (opening + posted = closing). {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
