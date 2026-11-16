"""As-of feature engineering, calculated only from raw transactions known by ``as_of``.

Usage::

    view = prepare(customer_data).view(as_of)   # hard cut-off at as_of
    feats = compute_features(view)

``view`` contains only posted/failed transactions with ``posted_at <= as_of`` and
scheduled events with ``known_at <= as_of``. Simulation events (shocks) and
repayment outcomes are never passed to a view, so they cannot leak into features.

Design note - income accrual
----------------------------
Weekly income is measured by spreading each income credit forward across that
source's own inferred pay cadence (a fortnightly $1,200 pay contributes $600 to
each of the next two weeks). This avoids "payday lumpiness": a perfectly regular
fortnightly or monthly earner does not look volatile or suddenly income-less
just because a 7-day window missed a payday. If pay stops, accrual stops one
cadence after the last credit, so genuine income loss still shows up.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

import numpy as np

from . import config as C
from .ledger import CustomerData


# ============================================================== prepared arrays
@dataclass
class View:
    customer_id: str
    as_of: date
    history_start: date
    day: np.ndarray            # int ordinal
    amount: np.ndarray         # float AUD (signed)
    category: np.ndarray       # object
    posted: np.ndarray         # bool
    internal: np.ndarray       # bool
    accessible: np.ndarray     # bool (account is accessible liquid funds)
    source: np.ndarray         # object income_source_id
    opening_accessible: float
    scheduled: list[dict[str, Any]]
    _cache: dict[str, Any] = field(default_factory=dict, repr=False)

    @property
    def n_days(self) -> int:
        return (self.as_of - self.history_start).days + 1


class Prepared:
    def __init__(self, data: CustomerData):
        self.customer_id = data.customer_id
        self.history_start = date.fromisoformat(data.customer["history_start"])
        acc_access = {a["account_id"]: bool(a.get("accessible", True)) for a in data.accounts}
        self.opening_accessible = sum(a["opening_balance_cents"] for a in data.accounts
                                      if acc_access[a["account_id"]]) / 100.0
        txs = sorted(data.transactions, key=lambda t: (t["posted_at"], t["transaction_id"]))
        self.day = np.array([date.fromisoformat(t["posted_at"]).toordinal() for t in txs], dtype=np.int64)
        self.amount = np.array([t["amount_cents"] / 100.0 for t in txs], dtype=float)
        self.category = np.array([t["category"] for t in txs], dtype=object)
        self.posted = np.array([t["status"] == "posted" for t in txs], dtype=bool)
        self.internal = np.array([bool(t.get("is_internal")) for t in txs], dtype=bool)
        self.accessible = np.array([acc_access[t["account_id"]] for t in txs], dtype=bool)
        self.source = np.array([t.get("income_source_id") for t in txs], dtype=object)
        self.scheduled = sorted(data.scheduled_events, key=lambda e: e["known_at"])
        self._known = [date.fromisoformat(e["known_at"]) for e in self.scheduled]

    def view(self, as_of: date) -> View:
        if as_of < self.history_start:
            raise ValueError("as_of is before the start of observed history")
        k = int(np.searchsorted(self.day, as_of.toordinal(), side="right"))
        sched = [e for e, kn in zip(self.scheduled, self._known) if kn <= as_of]
        return View(self.customer_id, as_of, self.history_start, self.day[:k], self.amount[:k],
                    self.category[:k], self.posted[:k], self.internal[:k], self.accessible[:k],
                    self.source[:k], self.opening_accessible, sched)


def prepare(data: CustomerData) -> Prepared:
    return Prepared(data)


# ============================================================== helpers
def _isin(arr: np.ndarray, values: set[str]) -> np.ndarray:
    return np.isin(arr, list(values))


def _window_mask(v: View, days: int) -> np.ndarray:
    """Transactions in (as_of - days, as_of]."""
    return v.day > (v.as_of.toordinal() - days)


def daily_balances(v: View) -> np.ndarray:
    """End-of-day accessible balance for every day from history_start to as_of."""
    if "eod" in v._cache:
        return v._cache["eod"]
    m = v.posted & v.accessible
    idx = v.day[m] - v.history_start.toordinal()
    flows = np.bincount(idx, weights=v.amount[m], minlength=v.n_days)[: v.n_days]
    eod = v.opening_accessible + np.cumsum(flows)
    v._cache["eod"] = eod
    return eod


def accessible_balance(v: View) -> float:
    return float(daily_balances(v)[-1])


def _income_mask(v: View) -> np.ndarray:
    return v.posted & ~v.internal & _isin(v.category, C.INCOME_CATEGORIES) & (v.amount > 0)


@dataclass
class Cadence:
    days: int
    regular: bool
    gap_cv: float | None
    n_events: int
    gaps: list[int]


def infer_cadence(event_days: np.ndarray) -> Cadence:
    """Personal pay cadence from the dates of past credits from one source."""
    uniq = np.unique(event_days)
    if len(uniq) < 2:
        return Cadence(14, False, None, len(uniq), [])
    gaps = np.diff(uniq).astype(int)
    med = float(np.median(gaps))
    cv = float(np.std(gaps) / np.mean(gaps)) if np.mean(gaps) > 0 else None
    if abs(med - 7) <= 2:
        snapped = 7
    elif abs(med - 14) <= 3:
        snapped = 14
    elif 26 <= med <= 33:
        snapped = 30
    else:
        snapped = int(max(1, round(med)))
    regular = cv is not None and cv < 0.35
    return Cadence(snapped, regular, cv, len(uniq), gaps.tolist())


@dataclass
class IncomeStream:
    source_id: str
    cadence: Cadence
    last_day: date
    base_amount: float
    conservative_amount: float
    amount_cv: float | None
    status: str                 # active | overdue | lapsed
    total_90d: float

    def expected(self, as_of: date, horizon: int, scenario: str) -> list[tuple[date, float, str]]:
        """Estimated (never 'known') income dates/amounts in (as_of, as_of+horizon]."""
        c = self.cadence.days
        end = as_of + timedelta(days=horizon)
        if self.status == "lapsed":
            return []
        nxt = self.last_day + timedelta(days=c)
        if scenario == "base":
            amount = self.base_amount
            if nxt <= as_of:                      # overdue but not lapsed -> assume it arrives tomorrow
                nxt = as_of + timedelta(days=1)
        else:
            amount = self.conservative_amount
            if not self.cadence.regular:          # irregular payers: assume later than usual
                nxt += timedelta(days=math.ceil(c / 2))
            while nxt <= as_of:                   # overdue: assume this cycle is missed
                nxt += timedelta(days=c)
        out = []
        while nxt <= end:
            out.append((nxt, round(amount, 2), f"estimated from {self.cadence.days}-day cadence"))
            nxt += timedelta(days=c)
        return out


def income_streams(v: View) -> list[IncomeStream]:
    if "streams" in v._cache:
        return v._cache["streams"]
    m = _income_mask(v)
    streams: list[IncomeStream] = []
    as_ord = v.as_of.toordinal()
    for sid in sorted({s for s in v.source[m] if s is not None}):
        sm = m & (v.source == sid)
        d, a = v.day[sm], v.amount[sm]
        # one "pay" per day per source
        ud, inv = np.unique(d, return_inverse=True)
        pays = np.bincount(inv, weights=a)
        cad = infer_cadence(ud)
        last6 = pays[-6:]
        base = float(np.median(pays[-3:]))
        cons = float(np.quantile(last6, C.CONSERVATIVE_INCOME_QUANTILE)) if len(last6) else 0.0
        cv = float(np.std(last6) / np.mean(last6)) if len(last6) >= 3 and np.mean(last6) > 0 else None
        gap = as_ord - int(ud[-1])
        tolerance = cad.days if cad.regular else (max(cad.gaps) if cad.gaps else cad.days)
        if gap > 2 * tolerance + 3:
            status = "lapsed"
        elif gap > tolerance:
            status = "overdue"
        else:
            status = "active"
        tot90 = float(a[d > as_ord - 90].sum())
        streams.append(IncomeStream(sid, cad, date.fromordinal(int(ud[-1])), base, cons, cv, status, tot90))
    v._cache["streams"] = streams
    return streams


def accrued_daily_income(v: View) -> tuple[np.ndarray, int]:
    """Daily income accrual and index of the first fully-observed day."""
    n = v.n_days
    diff = np.zeros(n + 1)
    m = _income_mask(v)
    max_c = 0
    for st in income_streams(v):
        c = min(st.cadence.days, 31)
        max_c = max(max_c, c)
        sm = m & (v.source == st.source_id)
        for d, a in zip(v.day[sm], v.amount[sm]):
            i = int(d) - v.history_start.toordinal()
            diff[i] += a / c
            diff[min(n, i + c)] -= a / c
    # income without a source id (should not happen in this simulator) counts on the day
    loose = m & np.array([s is None for s in v.source], dtype=bool)
    for d, a in zip(v.day[loose], v.amount[loose]):
        i = int(d) - v.history_start.toordinal()
        diff[i] += a
        diff[i + 1] -= a
    return np.cumsum(diff)[:n], max_c


def expected_income(v: View, horizon: int, scenario: str,
                    customer_confirmed: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Income events assumed in (as_of, as_of+horizon] for a scenario.

    Priority: customer-confirmed amounts (replace all estimates) > bank-known confirmed
    scheduled income > cadence-based estimates.
    """
    end = v.as_of + timedelta(days=horizon)
    if customer_confirmed:
        return [{"date": date.fromisoformat(str(e["date"])), "amount": float(e["amount"]),
                 "basis": "customer_confirmed", "description": e.get("description", "Income confirmed by customer")}
                for e in customer_confirmed
                if v.as_of < date.fromisoformat(str(e["date"])) <= end]
    out = []
    confirmed_sources = {}
    for e in v.scheduled:
        if e["event_type"] != "income":
            continue
        due = date.fromisoformat(e["due_date"])
        if v.as_of < due <= end:
            out.append({"date": due, "amount": e["amount_cents"] / 100, "basis": "confirmed",
                        "description": e["description"]})
            confirmed_sources.setdefault(e.get("income_source_id"), []).append(due)
    for st in income_streams(v):
        for d, a, basis in st.expected(v.as_of, horizon, scenario):
            near = any(abs((d - cd).days) <= st.cadence.days / 2 for cd in confirmed_sources.get(st.source_id, []))
            if not near and a > 0:
                out.append({"date": d, "amount": a, "basis": basis,
                            "description": f"Expected income ({st.source_id}, {scenario})"})
    return sorted(out, key=lambda e: e["date"])


def scheduled_outgoings(v: View, horizon: int) -> list[dict[str, Any]]:
    """Known bills and repayments due in (as_of, as_of+horizon], known by as_of."""
    end = v.as_of + timedelta(days=horizon)
    out = []
    for e in v.scheduled:
        if e["event_type"] == "income":
            continue
        due = date.fromisoformat(e["due_date"])
        if v.as_of < due <= end:
            out.append(e | {"due": due})
    return sorted(out, key=lambda e: (e["due"], e["event_type"] != "bill"))


# ============================================================== features
def income_quality(v: View, customer_confirmed: list | None = None) -> dict[str, Any]:
    history_days = v.n_days
    n_income = int(_income_mask(v).sum())
    has_external_own = bool((v.posted & (v.category == "transfer_external_own")).any())
    _, max_c = accrued_daily_income(v)
    usable_days = history_days - max_c
    usable_baseline_weeks = max(0, min(C.BASELINE_WEEKS, usable_days // 7 - C.RECENT_WEEKS))
    if customer_confirmed:
        visibility = "customer_confirmed"
    elif n_income == 0:
        visibility = "partial" if has_external_own else "unknown"
    elif history_days < C.MIN_HISTORY_DAYS or usable_baseline_weeks < C.MIN_BASELINE_WEEKS:
        visibility = "partial"
    else:
        visibility = "adequate"
    if history_days < 56 or visibility == "unknown":
        dq = "insufficient"
    elif visibility == "partial" or history_days < C.MIN_HISTORY_DAYS:
        dq = "partial"
    else:
        dq = "sufficient"
    return {"history_days": history_days, "income_credits_observed": n_income,
            "usable_baseline_weeks": int(usable_baseline_weeks), "income_visibility": visibility,
            "data_quality": dq, "external_own_account_inflows": has_external_own}


def compute_features(v: View, customer_confirmed: list | None = None) -> dict[str, Any]:
    """Return feature values + missing flags + data-quality block. Never hand-set."""
    f: dict[str, Any] = {}
    missing: dict[str, str] = {}
    quality = income_quality(v, customer_confirmed)
    streams = income_streams(v)

    # ---- income_change_pct / income_volatility (accrued weekly income)
    accrued, max_c = accrued_daily_income(v)
    n = v.n_days
    weeks = []
    for k in range(1, C.RECENT_WEEKS + C.BASELINE_WEEKS + 1):
        lo, hi = n - 7 * k, n - 7 * (k - 1)
        if lo < max_c:          # week overlaps the not-fully-observed start of history
            break
        weeks.append(float(accrued[lo:hi].sum()))
    recent = weeks[: C.RECENT_WEEKS]
    baseline = weeks[C.RECENT_WEEKS:]
    if quality["income_credits_observed"] == 0:
        f["recent_weekly_income"] = f["baseline_weekly_income"] = None
        f["income_change_pct"] = f["income_volatility"] = None
        missing["income_change_pct"] = missing["income_volatility"] = "no_income_observed"
    elif len(recent) < C.RECENT_WEEKS or len(baseline) < C.MIN_BASELINE_WEEKS:
        f["recent_weekly_income"] = round(float(np.mean(recent)), 2) if recent else None
        f["baseline_weekly_income"] = None
        f["income_change_pct"] = f["income_volatility"] = None
        missing["income_change_pct"] = missing["income_volatility"] = "insufficient_baseline_weeks"
    else:
        r, b = float(np.mean(recent)), float(np.mean(baseline))
        f["recent_weekly_income"], f["baseline_weekly_income"] = round(r, 2), round(b, 2)
        if b <= 0:
            f["income_change_pct"] = f["income_volatility"] = None
            missing["income_change_pct"] = missing["income_volatility"] = "zero_baseline_income"
        else:
            f["income_change_pct"] = round((r - b) / b, 4)
            f["income_volatility"] = round(float(np.std(baseline) / b), 4)

    # ---- net_cash_flow_30d (external, posted, accessible accounts)
    w30 = _window_mask(v, C.CASHFLOW_WINDOW_DAYS)
    ext = v.posted & v.accessible & ~v.internal & ~_isin(v.category, C.EXCLUDED_FROM_CASHFLOW)
    f["net_cash_flow_30d"] = round(float(v.amount[w30 & ext].sum()), 2)
    if n < C.CASHFLOW_WINDOW_DAYS:
        missing["net_cash_flow_30d"] = "window_partially_observed"

    # ---- cash_buffer_days
    bal = accessible_balance(v)
    f["accessible_balance"] = round(bal, 2)
    ess_mask = w30 & v.posted & ~v.internal & (v.amount < 0) & \
        _isin(v.category, C.ESSENTIAL_CATEGORIES | C.REPAYMENT_CATEGORIES)
    essential_30 = float(-v.amount[ess_mask].sum())
    f["essential_outflows_30d"] = round(essential_30, 2)
    if essential_30 <= 0:
        f["cash_buffer_days"] = None
        missing["cash_buffer_days"] = "no_essential_outflows_observed"
    else:
        f["cash_buffer_days"] = round(max(bal, 0.0) / (essential_30 / 30.0), 2)

    # ---- repayment_coverage_ratio (conservative income vs known obligations, next 30 days)
    obligations = sum(e["amount_cents"] for e in scheduled_outgoings(v, 30)) / 100.0
    cons_income = sum(e["amount"] for e in expected_income(v, 30, "conservative", customer_confirmed))
    f["obligations_next_30d"] = round(obligations, 2)
    f["conservative_income_next_30d"] = round(cons_income, 2)
    if obligations <= 0:
        f["repayment_coverage_ratio"] = None
        missing["repayment_coverage_ratio"] = "no_known_obligations"
    elif quality["income_visibility"] == "unknown":
        f["repayment_coverage_ratio"] = None
        missing["repayment_coverage_ratio"] = "income_unknown"
    else:
        f["repayment_coverage_ratio"] = round(cons_income / obligations, 4)

    # ---- failed_payments_30d (observed unsuccessful attempts)
    failed = w30 & ~v.posted
    rep = _isin(v.category, C.REPAYMENT_CATEGORIES)
    f["failed_loan_payments_30d"] = int((failed & rep).sum())
    f["failed_other_payments_30d"] = int((failed & ~rep).sum())

    # ---- balance_change_30d: mean EOD balance last 7 days vs days -37..-8
    eod = daily_balances(v)
    if n >= 37:
        recent_bal = float(eod[-7:].mean())
        earlier_bal = float(eod[-37:-7].mean())
        f["balance_change_30d_aud"] = round(recent_bal - earlier_bal, 2)
        if abs(earlier_bal) < 1:
            f["balance_change_30d"] = None
            missing["balance_change_30d"] = "earlier_balance_near_zero"
        else:
            f["balance_change_30d"] = round((recent_bal - earlier_bal) / abs(earlier_bal), 4)
    else:
        f["balance_change_30d"] = f["balance_change_30d_aud"] = None
        missing["balance_change_30d"] = "insufficient_history"

    # ---- essential_expense_ratio (essential spend / accrued income over 30 days)
    income_30 = float(accrued[-30:].sum()) if n >= 30 else float(accrued.sum())
    f["income_30d"] = round(income_30, 2)
    if quality["income_credits_observed"] == 0:
        f["essential_expense_ratio"] = None
        missing["essential_expense_ratio"] = "income_not_observed"
    elif income_30 <= 0:
        f["essential_expense_ratio"] = None
        missing["essential_expense_ratio"] = "no_income_in_window"
    else:
        f["essential_expense_ratio"] = round(essential_30 / income_30, 4)

    # ---- income_gap_days relative to personal cadence
    live = [s for s in streams if s.total_90d > 0] or streams
    if not streams:
        f["income_gap_days"] = f["income_gap_ratio"] = f["expected_income_cadence_days"] = None
        missing["income_gap_days"] = "no_income_observed"
    else:
        last = max(s.last_day for s in streams)
        dominant = max(live, key=lambda s: s.total_90d)
        expected_gap = dominant.cadence.days if dominant.cadence.regular else \
            (float(np.quantile(dominant.cadence.gaps, 0.9)) if dominant.cadence.gaps else dominant.cadence.days)
        gap = (v.as_of - last).days
        f["income_gap_days"] = gap
        f["expected_income_cadence_days"] = round(float(expected_gap), 1)
        f["income_gap_ratio"] = round(gap / max(expected_gap, 1.0), 3)

    f["income_regular"] = all(s.cadence.regular for s in live) if streams else None
    return {"features": f, "missing_flags": missing, "quality": quality,
            "income_streams": [_stream_summary(s) for s in streams],
            "feature_version": C.FEATURE_VERSION}


def _stream_summary(s: IncomeStream) -> dict[str, Any]:
    return {"income_source_id": s.source_id, "cadence_days": s.cadence.days, "regular": s.cadence.regular,
            "last_observed_at": s.last_day.isoformat(), "base_amount": round(s.base_amount, 2),
            "conservative_amount": round(s.conservative_amount, 2),
            "amount_cv": None if s.amount_cv is None else round(s.amount_cv, 3), "status": s.status}


def weekly_income_history(v: View) -> list[dict[str, Any]]:
    """Actual income credits per calendar-aligned 7-day window (for charts)."""
    m = _income_mask(v)
    out = []
    n = v.n_days
    for k in range(n // 7, 0, -1):
        lo = v.as_of.toordinal() - 7 * k
        hi = lo + 7
        sel = m & (v.day > lo) & (v.day <= hi)
        out.append({"week_ending": date.fromordinal(hi).isoformat(), "income": round(float(v.amount[sel].sum()), 2)})
    return out
