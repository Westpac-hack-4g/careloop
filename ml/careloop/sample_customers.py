"""Deterministic demo customers built from RAW dated events.

Nothing here sets a tier, feature value or shortfall. Each customer is a plan of
dated income credits, bills, repayments and spending that the shared ``Ledger``
executes (failed payments are recorded, never debited). Features, forecasts
and tiers are then calculated by the same code used for every other customer.

For Sarah, the *underlying events* are constrained so that, as of 16 Nov 2026:
available balance = $420, expected pay before the repayment = $900,
known bills before the repayment = $940 and the home-loan repayment on
28 Nov = $1,000. The resulting $620 gap is computed, not stored.
"""
from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache
from typing import Callable

import numpy as np

from . import config as C
from .ledger import CustomerData, Ledger, PlanBuilder, cents

START, END, AS_OF = C.HISTORY_START, C.SIM_END, C.AS_OF_DATE


def every(first: date, step_days: int, start: date = START, end: date = END):
    """All dates first + k*step within [start, end] (first may be before start)."""
    d = first
    while d > start:
        d -= timedelta(days=step_days)
    while d <= end:
        if d >= start:
            yield d
        d += timedelta(days=step_days)


def weekday_dates(weekday: int, start: date = START, end: date = END):
    d = start + timedelta(days=(weekday - start.weekday()) % 7)
    while d <= end:
        yield d
        d += timedelta(days=7)


def monthly(dom: int, start: date = START, end: date = END):
    y, m = start.year, start.month
    while True:
        d = date(y, m, dom)
        if d > end:
            return
        if d >= start:
            yield d
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def _customer(cid: str, name: str, profile: str, story: str) -> dict:
    return {"customer_id": cid, "display_name": name, "profile_type": profile, "income_pattern_type": profile,
            "data_source": "synthetic_demo", "consent_demo": False, "story": story,
            "history_start": START.isoformat(), "generator_version": C.GENERATOR_VERSION}


def _account(cid: str, n: int, kind: str, opening: float) -> dict:
    return {"account_id": f"ACC-{cid}-{n}", "customer_id": cid, "account_type": kind,
            "opening_balance_cents": cents(opening), "accessible": True}


def _income_source(cid: str, n: int, source_type: str, freq: str, method: str, conf: float) -> dict:
    return {"income_source_id": f"INC-{cid}-{n}", "customer_id": cid, "source_type": source_type,
            "expected_frequency": freq, "detection_method": method, "confidence": conf, "last_observed_at": None}


def _finalise(data: CustomerData) -> CustomerData:
    for src in data.income_sources:
        seen = [t["posted_at"] for t in data.transactions
                if t["income_source_id"] == src["income_source_id"] and t["status"] == "posted"
                and t["posted_at"] <= AS_OF.isoformat()]
        src["last_observed_at"] = max(seen) if seen else None
    for acc in data.accounts:
        acc["available_balance_cents"] = data.balance_cents(acc["account_id"], AS_OF)
    return data


# ===================================================================== Alex
def build_alex() -> CustomerData:
    cid, rng = "ALEX", np.random.default_rng(101)
    data = CustomerData(_customer(cid, "Alex", "full_time",
                                  "Stable monthly salary, healthy savings and on-time repayments."),
                        [_account(cid, 1, "everyday", 4200), _account(cid, 2, "savings", 18500)],
                        income_sources=[_income_source(cid, 1, "salary", "monthly", "payroll_label", 0.98)])
    p = PlanBuilder(data, f"ACC-{cid}-1", START)
    for d in monthly(15):
        p.add(d, "income", 6400, "salary", income_source_id=f"INC-{cid}-1", description="Salary - employer payroll")
    for d in monthly(1):
        p.commitment(d, "essential", 2100, "rent", description="Rent")
    for d in monthly(3):
        p.commitment(d, "essential", float(rng.uniform(170, 215)), "utilities", scheduled_aud=190,
                     amount_status="estimated", description="Electricity & gas")
    for d in monthly(8):
        p.commitment(d, "essential", 140, "insurance", description="Insurance premium")
    for d in monthly(12):
        p.commitment(d, "essential", 95, "phone_internet", description="Phone & internet")
    for d in monthly(25):
        p.commitment(d, "card", 450, "card_repayment", loan_id="CARD-ALEX", description="Credit card repayment")
    for d in monthly(16):
        p.add(d, "save", 1000, "transfer_internal", keep_cents=cents(1500), description="Monthly savings")
    for d in weekday_dates(5):
        p.add(d, "essential", float(rng.uniform(160, 210)), "groceries", description="Supermarket")
    for d in weekday_dates(0):
        p.add(d, "essential", float(rng.uniform(55, 70)), "transport", description="Public transport top-up")
    for d in weekday_dates(4):
        p.add(d, "discretionary", float(rng.uniform(40, 90)), "dining", description="Restaurant")
    for d in every(START + timedelta(days=4), 10):
        p.add(d, "discretionary", float(rng.uniform(50, 150)), "shopping", description="Retail")
    Ledger(data, f"ACC-{cid}-1", f"ACC-{cid}-2").run(p.plan)
    return _finalise(data)


# ===================================================================== Tom (+ savings control)
def _tom_plan(data: CustomerData, cid: str) -> PlanBuilder:
    rng = np.random.default_rng(202)
    p = PlanBuilder(data, f"ACC-{cid}-1", START)
    for d in weekday_dates(3):  # Thursday casual wages - naturally variable
        mean, sd = (790, 150) if d < date(2026, 10, 1) else (700, 110)
        p.add(d, "income", float(np.clip(rng.normal(mean, sd), 450, 1100)), "wages",
              income_source_id=f"INC-{cid}-1", description="Casual wages - hospitality employer")
    for d in weekday_dates(1):
        p.commitment(d, "essential", 330, "rent", description="Rent (share house)")
    for d in monthly(9):
        p.commitment(d, "essential", 65, "phone_internet", description="Mobile plan")
    for d in monthly(20):
        p.commitment(d, "essential", float(rng.uniform(80, 100)), "utilities", scheduled_aud=90,
                     amount_status="estimated", description="Electricity share")
    for d in every(date(2026, 11, 27), 14):
        p.commitment(d, "loan", 260, "loan_repayment", loan_id="CAR-TOM", description="Car loan repayment")
    for d in weekday_dates(5):
        p.add(d, "essential", float(rng.uniform(100, 125)), "groceries", description="Supermarket")
    for d in weekday_dates(0):
        p.add(d, "essential", float(rng.uniform(50, 60)), "transport", description="Fuel")
    for d in weekday_dates(2):
        p.add(d, "discretionary", float(rng.uniform(25, 45)), "dining", description="Takeaway")
    for d in weekday_dates(4):
        p.add(d, "discretionary", float(rng.uniform(30, 50)), "dining", description="Cafe")
    for d in weekday_dates(5):
        p.add(d, "discretionary", float(rng.uniform(45, 75)), "entertainment", description="Night out")
    for d in every(START + timedelta(days=2), 9):
        p.add(d, "discretionary", float(rng.uniform(40, 120)), "shopping", description="Retail")
    return p


def build_tom() -> CustomerData:
    cid = "TOM"
    data = CustomerData(_customer(cid, "Tom", "casual",
                                  "Casual hospitality worker with naturally variable wages; balance shrinking "
                                  "and buffer thin, but upcoming repayments still covered."),
                        [_account(cid, 1, "everyday", 1900)],
                        income_sources=[_income_source(cid, 1, "wages", "weekly", "payroll_label", 0.9)])
    Ledger(data, f"ACC-{cid}-1").run(_tom_plan(data, cid).plan)
    return _finalise(data)


def build_tom_control() -> CustomerData:
    """Same wages (same volatility) and spending as Tom, plus large savings."""
    cid = "TOM_CONTROL"
    data = CustomerData(_customer(cid, "Tom (savings control)", "casual",
                                  "Fairness control: identical variable wages and spending to Tom, but "
                                  "$16,000 in accessible savings."),
                        [_account(cid, 1, "everyday", 1900), _account(cid, 2, "savings", 16000)],
                        income_sources=[_income_source(cid, 1, "wages", "weekly", "payroll_label", 0.9)])
    Ledger(data, f"ACC-{cid}-1", f"ACC-{cid}-2").run(_tom_plan(data, cid).plan)
    return _finalise(data)


# ===================================================================== Sarah
SARAH_BALANCE_AS_OF = 420.0


def _sarah_plan(data: CustomerData, cid: str) -> PlanBuilder:
    rng = np.random.default_rng(303)
    p = PlanBuilder(data, f"ACC-{cid}-1", START)
    hours_cut = date(2026, 10, 20)
    for d in every(date(2026, 11, 20), 14):   # fortnightly Friday pay
        amount = 900.0 if d >= hours_cut else round(float(rng.uniform(1185, 1220)), 2)
        p.add(d, "income", amount, "wages", income_source_id=f"INC-{cid}-1",
              description="Part-time wages - aged-care employer")
    for d in monthly(28):
        p.commitment(d, "loan", 1000, "loan_repayment", loan_id="HOME-SARAH", description="Home loan repayment")
    for d in monthly(18):
        p.commitment(d, "essential", 160, "insurance", description="Home & contents insurance")
    for d in monthly(12):
        p.commitment(d, "essential", 110, "phone_internet", description="Phone & internet")
    for d in monthly(21):
        p.commitment(d, "essential", 110, "rent", description="Strata levy (unit)")
    for d in monthly(9):
        p.commitment(d, "essential", 125, "insurance", description="Car insurance")
    for d in monthly(24):
        actual = 236.0 if d.month == 11 else float(rng.uniform(205, 245))
        p.commitment(d, "essential", actual, "utilities", scheduled_aud=230, amount_status="estimated",
                     description="Electricity & water")
    p.commitment(date(2026, 11, 25), "essential", 440, "transport", known_at=date(2026, 10, 26),
                 description="Car registration renewal (notice received 26 Oct)")
    for d in weekday_dates(6):
        p.add(d, "essential", float(rng.uniform(85, 105)), "groceries", description="Supermarket")
    for wd in (0, 3):
        for d in weekday_dates(wd):
            p.add(d, "essential", float(rng.uniform(28, 35)), "transport", description="Fuel")
    for d in weekday_dates(4):
        if d < hours_cut or d.isocalendar().week % 2 == 0:
            p.add(d, "discretionary", float(rng.uniform(30, 50) if d < hours_cut else rng.uniform(15, 25)),
                  "dining", optional=False, description="Takeaway")
    for d in every(START + timedelta(days=6), 14):
        if d < hours_cut:
            p.add(d, "discretionary", float(rng.uniform(40, 80)), "shopping", optional=False,
                  description="Retail")
    for d in weekday_dates(5):
        if d < hours_cut:
            p.add(d, "discretionary", float(rng.uniform(35, 60)), "entertainment", optional=False,
                  description="Weekend outing")
    return p


def build_sarah(balance_as_of: float = SARAH_BALANCE_AS_OF) -> CustomerData:
    cid = "SARAH"
    data = CustomerData(_customer(cid, "Sarah", "part_time",
                                  "Part-time aged-care worker whose hours were reduced in October; "
                                  "a home-loan repayment is due on 28 Nov."),
                        [_account(cid, 1, "everyday", 0)],
                        income_sources=[_income_source(cid, 1, "wages", "fortnightly", "payroll_label", 0.95)])
    plan = _sarah_plan(data, cid).plan
    # Choose the opening balance so the 16 Nov balance is exactly the target,
    # then let the ledger replay everything (and verify no historical failures).
    signed = {"income": 1, "essential": -1, "loan": -1, "card": -1, "discretionary": -1}
    net_to_as_of = sum(signed[e["kind"]] * e["amount_cents"] for e in plan if e["date"] <= AS_OF)
    data.accounts[0]["opening_balance_cents"] = cents(balance_as_of) - net_to_as_of
    Ledger(data, f"ACC-{cid}-1").run(plan)
    hist_fail = [t for t in data.transactions if t["status"] == "failed" and t["posted_at"] <= AS_OF.isoformat()]
    if hist_fail:
        raise RuntimeError(f"Sarah's calibrated history has failed payments: {hist_fail[:2]}")
    return _finalise(data)


# ===================================================================== Mia
def build_mia() -> CustomerData:
    cid, rng = "MIA", np.random.default_rng(404)
    data = CustomerData(_customer(cid, "Mia", "full_time",
                                  "Retail worker whose job ended in late September; savings ran down and "
                                  "a personal-loan repayment failed on 10 Nov."),
                        [_account(cid, 1, "everyday", 1400), _account(cid, 2, "savings", 1500)],
                        income_sources=[_income_source(cid, 1, "salary", "fortnightly", "payroll_label", 0.97)])
    p = PlanBuilder(data, f"ACC-{cid}-1", START)
    job_end = date(2026, 9, 30)
    for d in every(job_end, 14):
        if d < job_end:
            p.add(d, "income", float(rng.uniform(1430, 1470)), "salary", income_source_id=f"INC-{cid}-1",
                  description="Salary - retail employer")
        elif d == job_end:
            p.add(d, "income", 2050, "salary", income_source_id=f"INC-{cid}-1",
                  description="Final pay incl. leave payout")
    for d in weekday_dates(0):
        p.commitment(d, "essential", 400, "rent", description="Rent")
    for d in monthly(6):
        p.commitment(d, "essential", 70, "phone_internet", description="Phone & internet")
    for d in monthly(15):
        p.commitment(d, "essential", float(rng.uniform(135, 165)), "utilities", scheduled_aud=150,
                     amount_status="estimated", description="Electricity")
    for d in monthly(10):
        p.commitment(d, "loan", 380, "loan_repayment", loan_id="PL-MIA", description="Personal loan repayment")
    for d in monthly(25):
        p.commitment(d, "card", 120, "card_repayment", loan_id="CARD-MIA", description="Credit card repayment")
    for d in weekday_dates(5):
        p.add(d, "essential", float(rng.uniform(90, 110) if d < job_end else rng.uniform(55, 75)), "groceries",
              description="Supermarket")
    for d in weekday_dates(3):
        p.add(d, "essential", float(rng.uniform(35, 45)), "transport", description="Public transport")
    for d in weekday_dates(4):
        if d < job_end:
            p.add(d, "discretionary", float(rng.uniform(60, 110)), "dining", description="Dinner out")
    for d in every(START + timedelta(days=3), 12):
        if d < job_end:
            p.add(d, "discretionary", float(rng.uniform(50, 130)), "shopping", description="Retail")
    Ledger(data, f"ACC-{cid}-1", f"ACC-{cid}-2").run(p.plan)
    return _finalise(data)


BUILDERS: dict[str, Callable[[], CustomerData]] = {
    "ALEX": build_alex, "TOM": build_tom, "SARAH": build_sarah, "MIA": build_mia, "TOM_CONTROL": build_tom_control,
}
DEMO_ORDER = ["ALEX", "TOM", "SARAH", "MIA"]


@lru_cache(maxsize=None)
def _cached(cid: str) -> CustomerData:
    return BUILDERS[cid]()


def demo_customer(cid: str, fresh: bool = False) -> CustomerData:
    """Return a demo customer. ``fresh=True`` rebuilds (safe to mutate in tests)."""
    cid = cid.upper()
    if cid not in BUILDERS:
        raise KeyError(cid)
    if fresh:
        return BUILDERS[cid]()
    import copy
    return copy.deepcopy(_cached(cid))


def all_demo_customers() -> list[CustomerData]:
    return [demo_customer(c) for c in BUILDERS]
