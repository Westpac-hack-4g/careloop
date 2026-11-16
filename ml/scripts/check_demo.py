"""Print each demo customer's tier, warning signals and Sarah's shortfall (no browser needed).

    python scripts/check_demo.py
"""
import _path  # noqa: F401
from careloop import config as C
from careloop.sample_customers import BUILDERS
from careloop.service import analyse_data, get_customer_data

EXPECTED = {"ALEX": 0, "TOM": 1, "SARAH": 2, "MIA": 3, "TOM_CONTROL": 0}


def main() -> None:
    print(f"CareLoop demo check - as of {C.AS_OF_DATE} (synthetic data, AUD)\n")
    ok = True
    for cid in BUILDERS:
        r = analyse_data(get_customer_data(cid))
        f, fc = r.features, r.forecast
        gap = (f"gap AUD {fc.shortfall_amount_aud:,.2f} on {fc.shortfall_date}"
               if fc.shortfall_amount_aud else "no base-case gap")
        ml = r.ml_experiment
        ml_txt = ml.model_status + (f" {ml.predicted_probability:.2f}" if ml.predicted_probability is not None else "")
        print(f"{r.display_name:<22} Tier {r.financial_tier} {r.tier_label:<14} | {gap:<30} | "
              f"buffer {f['cash_buffer_days']} d | net 30d {f['net_cash_flow_30d']:+,.0f} | ML: {ml_txt}")
        print(f"{'':<22} reasons: {', '.join(r.reason_codes) or '-'}")
        ok &= r.financial_tier == EXPECTED[cid]
    sarah = analyse_data(get_customer_data("SARAH")).forecast
    print(f"\nSarah: you may be AUD {sarah.shortfall_amount_aud:,.0f} short on {sarah.shortfall_date} "
          f"(base case; stress case up to AUD {sarah.conservative.shortfall_amount_aud:,.0f}).")
    ok &= sarah.shortfall_amount_aud == 620.0 and sarah.shortfall_date == "2026-11-28"
    print("\nAll demo expectations met." if ok else "\nWARNING: a demo expectation was not met.")
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
