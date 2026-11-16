"""Event-driven synthetic cohort simulator (seeded, deterministic).

Each customer gets an income pattern (full-time, part-time, casual, freelancer,
retiree), bills, at least one loan/card repayment, behavioural discretionary
spending, optional savings, and exogenous shocks. Shocks change TRANSACTIONS
(reduced pay, missing invoices, bigger bills, emergencies); they never assign a
risk class. Shock probabilities and financial resilience (savings, budget
tightness) are drawn independently of income type so the simulator does not
build in an unfair link between irregular income and failure.

``income_pattern_type`` governs how transactions are generated only; it is not an
ML feature.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any

import numpy as np

from . import config as C
from .ledger import CustomerData, Ledger, PlanBuilder, cents
from .sample_customers import every, monthly

PROFILE_WEIGHTS = {"full_time": 0.35, "part_time": 0.20, "casual": 0.15, "freelancer": 0.15, "retiree": 0.15}
SOURCE_TYPE = {"full_time": "salary", "part_time": "wages", "casual": "wages", "freelancer": "client_invoice",
               "retiree": "pension"}


def _lognormal(rng, mean, sigma, lo, hi):
    return float(np.clip(rng.lognormal(np.log(mean), sigma), lo, hi))


def _shocks(rng, ptype: str, start: date, end: date) -> list[dict[str, Any]]:
    """Exogenous events. Same expected count for every income type."""
    out = []
    span = (end - start).days
    for _ in range(rng.poisson(1.2)):
        day = start + timedelta(days=int(rng.integers(30, span)))
        if ptype == "retiree":
            kind = rng.choice(["emergency_expense", "utility_increase", "payment_reduction"], p=[0.5, 0.3, 0.2])
        elif ptype == "freelancer":
            kind = rng.choice(["client_loss", "late_invoices", "emergency_expense", "utility_increase"],
                              p=[0.3, 0.2, 0.3, 0.2])
        else:
            kind = rng.choice(["reduced_hours", "job_loss", "delayed_wage", "emergency_expense", "utility_increase"],
                              p=[0.25, 0.12, 0.13, 0.3, 0.2])
        params: dict[str, Any] = {}
        if kind in ("reduced_hours", "payment_reduction"):
            params = {"multiplier": round(float(rng.uniform(0.45, 0.8) if kind == "reduced_hours"
                                                else rng.uniform(0.8, 0.9)), 3),
                      "duration_days": int(rng.integers(30, 120))}
        elif kind == "job_loss":
            params = {"duration_days": int(rng.integers(25, 90)), "new_job_multiplier": round(float(rng.uniform(0.7, 1.1)), 3)}
        elif kind == "client_loss":
            params = {"multiplier": round(float(rng.uniform(0.15, 0.5)), 3), "duration_days": int(rng.integers(30, 100))}
        elif kind == "late_invoices":
            params = {"extra_delay_days": int(rng.integers(10, 30)), "duration_days": int(rng.integers(30, 70))}
        elif kind == "delayed_wage":
            params = {"delay_days": int(rng.integers(4, 12))}
        elif kind == "emergency_expense":
            params = {"amount": round(float(rng.uniform(500, 3500)), 2),
                      "category": str(rng.choice(["transport", "utilities", "groceries"]))}
        elif kind == "utility_increase":
            params = {"multiplier": round(float(rng.uniform(1.3, 1.9)), 3)}
        out.append({"date": day, "type": str(kind), "params": params})
    return sorted(out, key=lambda s: s["date"])


def _income_multiplier(day: date, shocks: list[dict]) -> float:
    m = 1.0
    for s in shocks:
        p, d0 = s["params"], s["date"]
        if s["type"] in ("reduced_hours", "payment_reduction", "client_loss") and \
                d0 <= day < d0 + timedelta(days=p["duration_days"]):
            m *= p["multiplier"]
        elif s["type"] == "job_loss" and day >= d0:
            m *= 0.0 if day < d0 + timedelta(days=p["duration_days"]) else p["new_job_multiplier"]
    return m


def _pays(rng, ptype: str, weekly: float, start: date, end: date, shocks: list[dict], cid: str):
    """Return (list of income events, income_sources)."""
    events, sources = [], []
    src = lambda n, t, f, method, conf: {  # noqa: E731
        "income_source_id": f"INC-{cid}-{n}", "customer_id": cid, "source_type": t, "expected_frequency": f,
        "detection_method": method, "confidence": conf, "last_observed_at": None}
    delayed = [s for s in shocks if s["type"] == "delayed_wage"]

    def emit(day, amount, category, sid, desc, cpty):
        for s in delayed:
            if s["date"] <= day < s["date"] + timedelta(days=14):
                day = day + timedelta(days=s["params"]["delay_days"])
                delayed.remove(s)
                break
        amount *= _income_multiplier(day, shocks)
        if amount >= 1 and start <= day <= end:
            events.append({"date": day, "amount": round(amount, 2), "category": category,
                           "income_source_id": sid, "description": desc, "counterparty_type": cpty})

    first = start - timedelta(days=int(rng.integers(0, 14)))
    if ptype in ("full_time", "part_time", "casual"):
        if ptype == "full_time":
            freq = int(rng.choice([7, 14, 30], p=[0.25, 0.5, 0.25]))
            noise = 0.02
        elif ptype == "part_time":
            freq, noise = int(rng.choice([7, 14], p=[0.4, 0.6])), 0.12
        else:
            freq, noise = int(rng.choice([7, 14], p=[0.8, 0.2])), 0.30
        sources.append(src(1, SOURCE_TYPE[ptype], {7: "weekly", 14: "fortnightly", 30: "monthly"}[freq],
                           "payroll_label", 0.95))
        dates = monthly(int(rng.integers(1, 29)), start, end) if freq == 30 else every(first, freq, start, end)
        for d in dates:
            amt = weekly * (freq if freq != 30 else 30.4) / 7 * max(0.2, 1 + rng.normal(0, noise))
            if ptype == "casual" and rng.random() < 0.10:
                amt *= 0.4          # normal quiet week
            emit(d, amt, "salary" if ptype == "full_time" else "wages", f"INC-{cid}-1",
                 f"{ptype.replace('_', '-')} pay", "employer")
    elif ptype == "freelancer":
        n_payers = int(rng.integers(1, 4))
        shares = rng.dirichlet(np.ones(n_payers))
        late = [s for s in shocks if s["type"] == "late_invoices"]
        for j in range(n_payers):
            sid = f"INC-{cid}-{j + 1}"
            sources.append(src(j + 1, "client_invoice", "irregular", "pattern_inferred", 0.6))
            gap_mean = float(rng.uniform(12, 35))
            d = start - timedelta(days=int(rng.integers(0, 30)))
            while d <= end:
                amt = weekly * shares[j] * gap_mean / 7 * _lognormal(rng, 1.0, 0.45, 0.2, 3.0)
                pay_day = d + timedelta(days=int(rng.integers(0, 15)))
                for s in late:
                    if s["date"] <= pay_day < s["date"] + timedelta(days=s["params"]["duration_days"]):
                        pay_day += timedelta(days=s["params"]["extra_delay_days"])
                emit(pay_day, amt, "client_invoice", sid, "Client invoice payment", "client")
                d += timedelta(days=max(5, int(rng.normal(gap_mean, gap_mean * 0.35))))
    else:  # retiree
        sources.append(src(1, "pension", "fortnightly", "payroll_label", 0.99))
        for d in every(first, 14, start, end):
            emit(d, weekly * 2 * 0.75 * (1 + rng.normal(0, 0.005)), "pension", f"INC-{cid}-1",
                 "Age pension", "government")
        dom = int(rng.integers(1, 29))
        sources.append(src(2, "other_income", "monthly", "payroll_label", 0.9))
        for d in monthly(dom, start, end):
            emit(d, weekly * 0.25 * 30.4 / 7, "other_income", f"INC-{cid}-2", "Super income stream", "super_fund")
    return sorted(events, key=lambda e: e["date"]), sources


def simulate_customer(idx: int, seed: int = C.DEFAULT_SEED, start: date = C.HISTORY_START,
                      end: date = C.SIM_END) -> CustomerData:
    rng = np.random.default_rng([seed, idx])
    cid = f"SYN-{idx:05d}"
    ptype = str(rng.choice(list(PROFILE_WEIGHTS), p=list(PROFILE_WEIGHTS.values())))
    weekly = {"full_time": _lognormal(rng, 1250, 0.30, 650, 3200), "part_time": _lognormal(rng, 760, 0.25, 380, 1500),
              "casual": _lognormal(rng, 650, 0.30, 300, 1400), "freelancer": _lognormal(rng, 1150, 0.40, 400, 3500),
              "retiree": _lognormal(rng, 620, 0.20, 420, 1200)}[ptype]
    income_elsewhere = ptype != "retiree" and rng.random() < 0.04
    tightness = float(np.clip(rng.normal(1.03, 0.14), 0.70, 1.35))   # spending / income, type-independent
    spend = weekly * tightness
    resilience = rng.choice(["low", "medium", "high"], p=[0.35, 0.40, 0.25])
    savings = {"low": rng.uniform(0, 0.5), "medium": rng.uniform(2, 8), "high": rng.uniform(10, 60)}[resilience] * weekly
    checking = float(rng.uniform(0.5, 2.5)) * weekly

    data = CustomerData(
        {"customer_id": cid, "display_name": f"Synthetic customer {idx}", "profile_type": ptype,
         "income_pattern_type": ptype, "data_source": "synthetic", "consent_demo": True,
         "story": f"Randomly simulated {ptype.replace('_', ' ')} customer (seed {seed}).",
         "history_start": start.isoformat(), "generator_version": C.GENERATOR_VERSION},
        [{"account_id": f"ACC-{cid}-1", "customer_id": cid, "account_type": "everyday",
          "opening_balance_cents": cents(checking), "accessible": True},
         {"account_id": f"ACC-{cid}-2", "customer_id": cid, "account_type": "savings",
          "opening_balance_cents": cents(savings), "accessible": True}])
    shocks = _shocks(rng, ptype, start, end)
    p = PlanBuilder(data, f"ACC-{cid}-1", start)

    pays, sources = _pays(rng, ptype, weekly, start, end, shocks, cid)
    if income_elsewhere:     # salary lands at another bank; customer tops up this account
        for e in pays:
            p.add(e["date"], "inflow", e["amount"] * 0.95, "transfer_external_own",
                  description="Transfer from own account at another bank")
    else:
        data.income_sources = sources
        for e in pays:
            p.add(e["date"], "income", e["amount"], e["category"], income_source_id=e["income_source_id"],
                  description=e["description"], counterparty_type=e["counterparty_type"])

    # --- housing + loans: everyone has at least one loan/card repayment
    has_mortgage = rng.random() < (0.30 if ptype == "retiree" else 0.45)
    owns_outright = ptype == "retiree" and not has_mortgage and rng.random() < 0.6
    loan_dom = int(rng.integers(1, 29))
    if has_mortgage:
        amt = spend * 4.345 * rng.uniform(0.30, 0.38)
        if rng.random() < 0.5:
            for d in monthly(loan_dom, start, end):
                p.commitment(d, "loan", amt, "loan_repayment", loan_id=f"HL-{cid}", description="Home loan repayment")
        else:
            for d in every(start + timedelta(days=int(rng.integers(0, 14))), 14, start, end):
                p.commitment(d, "loan", amt * 12 / 26, "loan_repayment", loan_id=f"HL-{cid}",
                             description="Home loan repayment")
    elif not owns_outright:
        rent_w = spend * rng.uniform(0.28, 0.36)
        if rng.random() < 0.6:
            for d in every(start + timedelta(days=int(rng.integers(0, 7))), 7, start, end):
                p.commitment(d, "essential", rent_w, "rent", description="Rent")
        else:
            for d in every(start + timedelta(days=int(rng.integers(0, 14))), 14, start, end):
                p.commitment(d, "essential", rent_w * 2, "rent", description="Rent")
    need_other = not has_mortgage or rng.random() < 0.4
    if need_other:
        if rng.random() < 0.6:
            for d in monthly(int(rng.integers(1, 29)), start, end):
                p.commitment(d, "loan", spend * 4.345 * rng.uniform(0.06, 0.12), "loan_repayment",
                             loan_id=f"PL-{cid}", description="Car / personal loan repayment")
        else:
            for d in monthly(int(rng.integers(1, 29)), start, end):
                p.commitment(d, "card", spend * 4.345 * rng.uniform(0.03, 0.07), "card_repayment",
                             loan_id=f"CC-{cid}", description="Credit card repayment")

    # --- bills
    util = spend * 4.345 * rng.uniform(0.04, 0.06)
    util_inc = [s for s in shocks if s["type"] == "utility_increase"]
    for d in monthly(int(rng.integers(1, 29)), start, end):
        mult = np.prod([s["params"]["multiplier"] for s in util_inc if s["date"] <= d]) if util_inc else 1.0
        p.commitment(d, "essential", util * mult * rng.uniform(0.85, 1.15), "utilities", scheduled_aud=util,
                     amount_status="estimated", description="Utilities")
    for d in monthly(int(rng.integers(1, 29)), start, end):
        p.commitment(d, "essential", spend * 4.345 * 0.03, "insurance", description="Insurance")
    for d in monthly(int(rng.integers(1, 29)), start, end):
        p.commitment(d, "essential", float(rng.uniform(55, 140)), "phone_internet", description="Phone & internet")

    # --- everyday essentials (not scheduled; known only from history)
    g_day = int(rng.integers(0, 7))
    for d in every(start + timedelta(days=g_day), 7, start, end):
        p.add(d, "essential", spend * rng.uniform(0.12, 0.16), "groceries", description="Supermarket")
    for d in every(start + timedelta(days=int(rng.integers(0, 7))), 7, start, end):
        p.add(d, "essential", spend * rng.uniform(0.06, 0.09), "transport", description="Transport")

    # --- behavioural discretionary spending (skipped when money is tight)
    disc_weekly = max(spend * 0.05, spend * float(rng.uniform(0.10, 0.22)))
    d = start
    while d <= end:
        if rng.random() < 0.4:
            p.add(d, "discretionary", disc_weekly / 2.8 * rng.uniform(0.5, 1.5),
                  str(rng.choice(["dining", "entertainment", "shopping"])), description="Discretionary")
        d += timedelta(days=1)

    for s in shocks:
        if s["type"] == "emergency_expense":
            p.add(s["date"], "essential", s["params"]["amount"], s["params"]["category"],
                  description="Unexpected essential expense")
    # --- savings habit: move part of surplus on income days
    for e in pays[::2]:
        p.add(e["date"], "save", weekly * 0.3, "transfer_internal", keep_cents=cents(weekly * 3),
              description="Savings transfer")

    for s in shocks:
        data.simulation_events.append({"event_id": f"SIM-{cid}-{len(data.simulation_events) + 1:03d}",
                                       "customer_id": cid, "event_date": s["date"].isoformat(),
                                       "event_type": s["type"], "parameters_json": json.dumps(s["params"])})
    data.customer["simulation_parameters"] = {
        "weekly_income": round(weekly, 2), "tightness": round(tightness, 3), "resilience": str(resilience),
        "income_elsewhere": bool(income_elsewhere), "has_mortgage": bool(has_mortgage)}
    Ledger(data, f"ACC-{cid}-1", f"ACC-{cid}-2").run(p.plan)
    for src in data.income_sources:
        seen = [t["posted_at"] for t in data.transactions if t["income_source_id"] == src["income_source_id"]
                and t["status"] == "posted" and t["posted_at"] <= C.AS_OF_DATE.isoformat()]
        src["last_observed_at"] = max(seen) if seen else None
    for acc in data.accounts:
        acc["available_balance_cents"] = data.balance_cents(acc["account_id"], C.AS_OF_DATE)
    return data


def generate_cohort(n: int = C.DEFAULT_COHORT_SIZE, seed: int = C.DEFAULT_SEED) -> list[CustomerData]:
    return [simulate_customer(i, seed) for i in range(1, n + 1)]


def generator_info(n: int, seed: int) -> dict[str, Any]:
    return {"generator_version": C.GENERATOR_VERSION, "seed": seed, "customers": n,
            "history_start": C.HISTORY_START.isoformat(), "as_of_date": C.AS_OF_DATE.isoformat(),
            "simulation_end": C.SIM_END.isoformat(), "profile_weights": PROFILE_WEIGHTS}
