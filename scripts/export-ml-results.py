"""Export the ML service's results for the demo customers into data/ml-results.json.

The app does not recompute risk. It renders what the Python service (in the
folder `ml/`) worked out: features, warning signals, tier, the 14-day forecast and the
experimental ML score. Run this whenever the ML code or its demo customers change.

    <ml venv python> scripts/export-ml-results.py --ml-dir <path to the ml folder>

Example (Windows):
    ml\\.venv\\Scripts\\python.exe scripts\\export-ml-results.py --ml-dir ml

Synthetic data only. Thresholds are demo settings, not Westpac policy.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import timedelta
from pathlib import Path

# The app's customer ids, mapped to the ML service's demo customers.
CUSTOMERS = {"alex": "ALEX", "tom": "TOM", "sarah": "SARAH", "mia": "MIA", "tom_control": "TOM_CONTROL"}
HISTORY_DAYS = 120


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ml-dir", required=True, help="Folder that holds the ML service (contains careloop/)")
    parser.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "data" / "ml-results.json"))
    args = parser.parse_args()

    ml_dir = Path(args.ml_dir).resolve()
    sys.path.insert(0, str(ml_dir))
    os.chdir(ml_dir)  # the service finds its trained model relative to this folder

    from careloop import __version__, config as C, service  # noqa: E402
    from careloop.schemas import AnalysisRequest  # noqa: E402

    as_of = C.AS_OF_DATE
    out: dict = {
        "source": f"CareLoop ML service v{__version__} (synthetic data)",
        "as_of_date": as_of.isoformat(),
        "forecast_days": C.LOOKAHEAD_DAYS,
        "model": service.model_metrics().get("model_status"),
        "customers": {},
    }
    for app_id, ml_id in CUSTOMERS.items():
        analysis = service.analyse(AnalysisRequest(customer_id=ml_id, consent_confirmed=True, as_of_date=as_of))
        detail = service.customer_detail(ml_id, as_of, days=HISTORY_DAYS)
        data = service.get_customer_data(ml_id)
        txs = sorted(detail.recent_transactions, key=lambda t: t.posted_at)
        lo = (as_of - timedelta(days=HISTORY_DAYS)).isoformat()
        out["customers"][app_id] = {
            "story": data.customer.get("story"),
            "profile_type": data.customer.get("profile_type"),
            "accounts": [a for a in detail.accounts],
            "pays": [{"date": t.posted_at, "amount": t.amount} for t in txs
                     if t.direction == "credit" and t.income_source_id and t.status == "posted"],
            "repayments": [{"date": t.posted_at, "amount": abs(t.amount), "description": t.description,
                            "category": t.category, "status": t.status} for t in txs
                           if t.category in ("loan_repayment", "card_repayment") and t.posted_at > lo],
            "upcoming": detail.known_upcoming_events,
            "analysis": analysis.model_dump(mode="json"),
        }
    Path(args.out).write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Wrote {args.out}")
    for app_id, c in out["customers"].items():
        a, f = c["analysis"], c["analysis"]["forecast"]
        gap = f"${f['shortfall_amount_aud']:.0f} on {f['shortfall_date']}" if f["shortfall_amount_aud"] else "no gap"
        print(f"  {app_id:12} tier {a['financial_tier']}  {gap}  ML: {a['ml_experiment']['model_status']}")


if __name__ == "__main__":
    main()
