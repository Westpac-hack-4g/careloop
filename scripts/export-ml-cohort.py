"""Export one line per customer for the nightly report into data/ml-cohort.json.

The Risk Tracking service (in the folder `ml/`) looks at every customer of the bank.
The report then groups its results by branch. This script runs the service's own
analysis over its synthetic cohort and keeps only what the report counts: tier,
warning signals, the 14-day shortfall and the ML band. No names, no transactions.

    <ml venv python> scripts/export-ml-cohort.py --ml-dir ml

Synthetic data only. The branch is made up. The demo shows one branch, so every
customer is placed in it; add more names to BRANCHES to spread them out.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# Made-up branches and the share of the cohort each one gets. One branch takes everyone.
BRANCHES = [("Southport", 1)]
# The three customers the app shows by name, and the branch they bank at.
DEMO = {"sarah": "SARAH", "tom": "TOM", "mia": "MIA"}
DEMO_BRANCH = "Southport"


def branch_for(index: int) -> str:
    slot = (index * 7) % sum(share for _, share in BRANCHES)
    for name, share in BRANCHES:
        if slot < share:
            return name
        slot -= share
    return BRANCHES[-1][0]


def row(customer_id: str, branch: str, analysis) -> dict:
    a = analysis.model_dump(mode="json")
    fc, ml = a["forecast"], a["ml_experiment"]
    band = None
    if ml["model_status"] == "available" and ml["predicted_probability"] is not None:
        band = "High" if ml["above_threshold"] else "Elevated" if ml["predicted_probability"] >= 0.5 else "Low"
    return {
        "id": customer_id,
        "branch": branch,
        "tier": a["financial_tier"],
        "signals": a["warning_signals"],
        "shortfall": round(fc["shortfall_amount_aud"]),
        "shortfall_date": fc["shortfall_date"],
        "ml_band": band,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ml-dir", required=True, help="Folder that holds the ML service (contains careloop/)")
    parser.add_argument("--customers", type=int, default=1000)
    parser.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "data" / "ml-cohort.json"))
    args = parser.parse_args()

    ml_dir = Path(args.ml_dir).resolve()
    sys.path.insert(0, str(ml_dir))
    os.chdir(ml_dir)  # the service finds its trained model relative to this folder

    from careloop import __version__, config as C, service  # noqa: E402
    from careloop.sample_customers import demo_customer  # noqa: E402
    from careloop.simulator import generate_cohort  # noqa: E402

    as_of = C.AS_OF_DATE
    rows = [row(app_id, DEMO_BRANCH, service.analyse_data(demo_customer(ml_id), as_of)) for app_id, ml_id in DEMO.items()]
    for index, data in enumerate(generate_cohort(args.customers, C.DEFAULT_SEED), start=1):
        rows.append(row(data.customer_id, branch_for(index), service.analyse_data(data, as_of)))

    out = {
        "source": f"CareLoop ML service v{__version__} (synthetic data, made-up branch)",
        "as_of_date": as_of.isoformat(),
        "forecast_days": C.LOOKAHEAD_DAYS,
        "branches": [name for name, _ in BRANCHES],
        "customers": rows,
    }
    Path(args.out).write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    print(f"Wrote {args.out}: {len(rows)} customers")
    for name, _ in BRANCHES:
        mine = [r for r in rows if r["branch"] == name]
        short = [r for r in mine if r["shortfall"] > 0]
        tiers = {t: sum(r["tier"] == t for r in mine) for t in (0, 1, 2, 3, None)}
        print(f"  {name:15} {len(mine):4} customers  tiers {tiers}  shortfalls {len(short)} (${sum(r['shortfall'] for r in short):,})")


if __name__ == "__main__":
    main()
