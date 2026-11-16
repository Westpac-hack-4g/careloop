"""14-day daily cash-flow forecast with base and conservative scenarios.

Only information available at ``as_of`` is used: the current accessible balance,
scheduled bills/repayments with ``known_at <= as_of``, confirmed income, and
income *estimated* from the customer's own historical cadence.

* **base** - scheduled commitments + expected income (median of the last 3 pays).
  Everyday variable spending is assumed to flex around commitments.
* **conservative** - income at the 20th percentile of the last 6 pays (overdue or
  irregular income assumed late), estimated bills +10%, plus everyday essential
  spending at the customer's last-30-day average.

A shortfall is only reported as a *repayment* shortfall when the projected
balance is negative immediately after a scheduled loan/card repayment.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from . import config as C
from .features import View, accessible_balance, expected_income, income_quality, income_streams, \
    scheduled_outgoings, _isin, _window_mask

_ORDER = {"income": 0, "everyday": 1, "bill": 2, "loan_repayment": 3, "card_repayment": 3}


def everyday_essential_daily(v: View) -> float:
    m = _window_mask(v, 30) & v.posted & ~v.internal & (v.amount < 0) & \
        _isin(v.category, C.VARIABLE_ESSENTIAL_CATEGORIES)
    return float(-v.amount[m].sum()) / 30.0


def project(v: View, scenario: str = "base", horizon: int = C.LOOKAHEAD_DAYS,
            customer_confirmed: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    if scenario not in ("base", "conservative"):
        raise ValueError("scenario must be 'base' or 'conservative'")
    start_balance = accessible_balance(v)
    items: list[dict[str, Any]] = []
    for e in expected_income(v, horizon, scenario, customer_confirmed):
        items.append({"date": e["date"], "type": "income", "category": "income", "amount": round(e["amount"], 2),
                      "description": e["description"], "basis": e["basis"]})
    for e in scheduled_outgoings(v, horizon):
        amt = e["amount_cents"] / 100.0
        basis = e["amount_status"]
        if scenario == "conservative" and basis == "estimated":
            amt *= C.CONSERVATIVE_BILL_UPLIFT
            basis = "estimated (+10% stress)"
        items.append({"date": e["due"], "type": e["event_type"], "category": e["category"], "amount": -round(amt, 2),
                      "description": e["description"], "basis": f"scheduled ({basis})",
                      "loan_id": e.get("loan_id")})
    everyday = everyday_essential_daily(v) if scenario == "conservative" else 0.0
    items.sort(key=lambda it: (it["date"], _ORDER[it["type"]]))

    balance = start_balance
    daily, events = [], []
    shortfall, shortfall_date, planned, planned_date = 0.0, None, None, None
    lowest, lowest_date = start_balance, v.as_of
    by_day: dict[date, list] = {}
    for it in items:
        by_day.setdefault(it["date"], []).append(it)
    for k in range(1, horizon + 1):
        d = v.as_of + timedelta(days=k)
        todays = by_day.get(d, [])
        for it in todays:
            if it["type"] == "income":
                balance += it["amount"]
                events.append(_ev(it, balance))
        if everyday:
            balance -= everyday
        for it in todays:
            if it["type"] == "income":
                continue
            balance += it["amount"]
            events.append(_ev(it, balance))
            if it["type"] in ("loan_repayment", "card_repayment"):
                if planned is None:
                    planned, planned_date = -it["amount"], d
                if balance < 0:
                    gap = min(-it["amount"], -balance)
                    if gap > shortfall:
                        shortfall, shortfall_date = gap, d
                        planned, planned_date = -it["amount"], d
        if balance < lowest:
            lowest, lowest_date = balance, d
        daily.append({"date": d.isoformat(), "balance": round(balance, 2)})

    assumptions = [
        f"Starts from accessible balance of AUD {start_balance:,.2f} at end of {v.as_of.isoformat()}.",
        "Bills and repayments are scheduled items already known on the as-of date.",
    ]
    if customer_confirmed:
        assumptions.append("Income uses amounts confirmed by the customer (replaces estimates).")
    elif scenario == "base":
        assumptions.append("Income not yet confirmed is estimated from the customer's own pay cadence "
                           "(median of last 3 payments). Income not seen for 2+ cycles is not assumed to resume.")
    else:
        assumptions.append("Stress case: income at the 20th percentile of the last 6 payments; overdue or "
                           "irregular income assumed late; estimated bills +10%.")
        assumptions.append(f"Everyday essentials (groceries, transport) at AUD {everyday:,.2f}/day "
                           "from the last 30 days.")
    if scenario == "base":
        assumptions.append("Everyday discretionary and variable spending is not included in the base case.")
    return {
        "scenario": scenario, "horizon_days": horizon, "as_of_date": v.as_of.isoformat(),
        "start_balance_aud": round(start_balance, 2),
        "shortfall_amount_aud": round(shortfall, 2),
        "shortfall_date": shortfall_date.isoformat() if shortfall_date else None,
        "planned_repayment_aud": round(planned, 2) if planned is not None else None,
        "planned_repayment_date": planned_date.isoformat() if planned_date else None,
        "lowest_balance_aud": round(lowest, 2), "lowest_balance_date": lowest_date.isoformat(),
        "assumptions": assumptions, "daily_balances": daily, "events": events,
    }


def _ev(it: dict[str, Any], balance: float) -> dict[str, Any]:
    return {"date": it["date"].isoformat(), "description": it["description"], "category": it["category"],
            "event_type": it["type"], "amount_aud": round(it["amount"], 2), "basis": it["basis"],
            "balance_after_aud": round(balance, 2)}


def forecast_confidence(v: View, customer_confirmed: list | None = None) -> tuple[str, list[str]]:
    reasons = []
    q = income_quality(v, customer_confirmed)
    if customer_confirmed:
        return "medium", ["Income confirmed by the customer, not yet observed."]
    if q["income_visibility"] in ("unknown", "partial"):
        return "low", [f"Income visibility is {q['income_visibility']}."]
    live = [s for s in income_streams(v) if s.status != "lapsed"]
    level = "high"
    for s in live:
        if not s.cadence.regular:
            level = "low"
            reasons.append(f"{s.source_id}: irregular payment timing.")
        elif s.amount_cv is not None and s.amount_cv > 0.30:
            level = "low" if level != "low" else level
            reasons.append(f"{s.source_id}: highly variable amounts (CV {s.amount_cv:.2f}).")
        elif s.amount_cv is not None and s.amount_cv > 0.08 and level == "high":
            level = "medium"
            reasons.append(f"{s.source_id}: moderately variable amounts (CV {s.amount_cv:.2f}).")
    if not live:
        level = "medium"
        reasons.append("No current income stream is assumed.")
    if not reasons:
        reasons.append("Regular income timing and amounts.")
    return level, reasons


def forecast_pair(v: View, horizon: int = C.LOOKAHEAD_DAYS, customer_confirmed: list | None = None) -> dict[str, Any]:
    base = project(v, "base", horizon, customer_confirmed)
    cons = project(v, "conservative", horizon, customer_confirmed)
    conf, why = forecast_confidence(v, customer_confirmed)
    return {"base": base, "conservative": cons, "confidence": conf, "confidence_reasons": why,
            "shortfall_range_aud": [base["shortfall_amount_aud"], max(base["shortfall_amount_aud"],
                                                                      cons["shortfall_amount_aud"])]}
