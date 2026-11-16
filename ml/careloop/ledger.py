"""Customer data container and the accounting engine shared by every simulator.

Money is held internally as **integer cents**. A planned debit that cannot be
funded is recorded as a *failed* transaction / repayment outcome and is never
subtracted from the balance.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from . import config as C

# Order in which same-day events are applied: money in first, then obligations.
KIND_ORDER = {"income": 0, "inflow": 0, "transfer": 1, "essential": 2, "loan": 3, "card": 3,
              "discretionary": 4, "save": 5}


def cents(aud: float) -> int:
    return int(round(float(aud) * 100))


def aud(value_cents: int) -> float:
    return round(value_cents / 100.0, 2)


@dataclass
class CustomerData:
    """All synthetic records for one customer (both past and realised future).

    Analysis code must go through ``features.prepare(...).view(as_of)`` which
    cuts this down to information available on ``as_of``.
    """
    customer: dict[str, Any]
    accounts: list[dict[str, Any]]
    transactions: list[dict[str, Any]] = field(default_factory=list)
    income_sources: list[dict[str, Any]] = field(default_factory=list)
    scheduled_events: list[dict[str, Any]] = field(default_factory=list)
    repayment_outcomes: list[dict[str, Any]] = field(default_factory=list)
    simulation_events: list[dict[str, Any]] = field(default_factory=list)

    @property
    def customer_id(self) -> str:
        return self.customer["customer_id"]

    def account(self, account_id: str) -> dict[str, Any]:
        return next(a for a in self.accounts if a["account_id"] == account_id)

    def balance_cents(self, account_id: str, as_of: date | None = None) -> int:
        """Opening balance + posted amounts (optionally up to and including as_of)."""
        total = self.account(account_id)["opening_balance_cents"]
        for tx in self.transactions:
            if tx["account_id"] != account_id or tx["status"] != "posted":
                continue
            if as_of is not None and date.fromisoformat(tx["posted_at"]) > as_of:
                continue
            total += tx["amount_cents"]
        return total


class Ledger:
    """Applies planned events chronologically and keeps balances consistent."""

    def __init__(self, data: CustomerData, primary: str, savings: str | None = None,
                 discretionary_floor_cents: int = 10_000):
        self.data = data
        self.primary = primary
        self.savings = savings
        self.floor = discretionary_floor_cents
        self.balance = {a["account_id"]: a["opening_balance_cents"] for a in data.accounts}
        self._tx_n = 0
        self._out_n = 0

    # ---------------------------------------------------------------- low level
    def _post(self, day: date, account_id: str, amount_cents: int, category: str, *,
              status: str = "posted", counterparty_type: str = "merchant",
              income_source_id: str | None = None, description: str = "",
              is_internal: bool = False) -> dict[str, Any]:
        self._tx_n += 1
        tx = {
            "transaction_id": f"TX-{self.data.customer_id}-{self._tx_n:05d}",
            "account_id": account_id,
            "customer_id": self.data.customer_id,
            "posted_at": day.isoformat(),
            "amount_cents": int(amount_cents),
            "category": category,
            "direction": "credit" if amount_cents > 0 else "debit",
            "status": status,
            "counterparty_type": counterparty_type,
            "income_source_id": income_source_id,
            "description": description,
            "is_internal": bool(is_internal),
        }
        if status == "posted":
            self.balance[account_id] += amount_cents
        self.data.transactions.append(tx)
        return tx

    def _transfer(self, day: date, src: str, dst: str, amount_cents: int, description: str) -> None:
        """Internal transfer: both legs recorded, net zero for the customer."""
        self._post(day, src, -amount_cents, "transfer_internal", counterparty_type="own_account",
                   description=description, is_internal=True)
        self._post(day, dst, amount_cents, "transfer_internal", counterparty_type="own_account",
                   description=description, is_internal=True)

    def _fund(self, day: date, amount_cents: int) -> bool:
        """Ensure primary can pay; sweep from linked accessible savings if needed."""
        short = amount_cents - self.balance[self.primary]
        if short <= 0:
            return True
        if self.savings and self.balance[self.savings] >= short:
            self._transfer(day, self.savings, self.primary, short, "Auto-sweep from linked savings")
            return True
        return False

    # ---------------------------------------------------------------- event API
    def apply(self, ev: dict[str, Any]) -> None:
        day: date = ev["date"]
        kind = ev["kind"]
        amt = int(ev["amount_cents"])
        if amt <= 0:
            return
        if kind == "income":
            self._post(day, self.primary, amt, ev["category"],
                       counterparty_type=ev.get("counterparty_type", "employer"),
                       income_source_id=ev.get("income_source_id"),
                       description=ev.get("description", ""))
        elif kind == "inflow":  # non-income credit, e.g. transfer from own account at another bank
            self._post(day, self.primary, amt, ev["category"],
                       counterparty_type=ev.get("counterparty_type", "own_external_account"),
                       description=ev.get("description", ""))
        elif kind == "save":
            if self.savings and self.balance[self.primary] - amt >= ev.get("keep_cents", 0):
                self._transfer(day, self.primary, self.savings, amt, ev.get("description", "Savings transfer"))
        elif kind == "discretionary":
            # Behavioural spending: only happens if comfortably affordable (no record otherwise).
            if ev.get("optional", True) and self.balance[self.primary] - amt < self.floor:
                return
            if not ev.get("optional", True) and not self._fund(day, amt):
                self._post(day, self.primary, -amt, ev["category"], status="failed",
                           description=ev.get("description", ""))
                return
            self._post(day, self.primary, -amt, ev["category"], description=ev.get("description", ""))
        elif kind in ("essential", "loan", "card"):
            ok = self._fund(day, amt)
            cpty = "lender" if kind in ("loan", "card") else ev.get("counterparty_type", "biller")
            self._post(day, self.primary, -amt, ev["category"], status="posted" if ok else "failed",
                       counterparty_type=cpty, description=ev.get("description", ""))
            if kind in ("loan", "card"):
                self._out_n += 1
                self.data.repayment_outcomes.append({
                    "outcome_id": f"RO-{self.data.customer_id}-{self._out_n:04d}",
                    "customer_id": self.data.customer_id,
                    "loan_id": ev["loan_id"],
                    "due_date": day.isoformat(),
                    "attempted_at": day.isoformat(),
                    "amount_due_cents": amt,
                    "paid_amount_cents": amt if ok else 0,
                    "status": "success" if ok else "failed",
                })
        else:
            raise ValueError(f"Unknown event kind: {kind}")

    def run(self, plan: list[dict[str, Any]]) -> CustomerData:
        for ev in sorted(plan, key=lambda e: (e["date"], KIND_ORDER[e["kind"]], e.get("seq", 0))):
            self.apply(ev)
        return self.data


def reconcile(data: CustomerData) -> dict[str, tuple[int, int]]:
    """Return {account_id: (opening + posted sum, ledger closing)} for tests."""
    out = {}
    for acc in data.accounts:
        posted = sum(t["amount_cents"] for t in data.transactions
                     if t["account_id"] == acc["account_id"] and t["status"] == "posted")
        out[acc["account_id"]] = (acc["opening_balance_cents"] + posted, data.balance_cents(acc["account_id"]))
    return out


def scheduled(customer_id: str, account_id: str, n: int, due: date, amount_cents: int, event_type: str,
              category: str, known_at: date, amount_status: str, description: str,
              loan_id: str | None = None) -> dict[str, Any]:
    return {
        "event_id": f"SE-{customer_id}-{n:05d}",
        "customer_id": customer_id,
        "account_id": account_id,
        "due_date": due.isoformat(),
        "amount_cents": int(amount_cents),
        "event_type": event_type,           # bill | loan_repayment | card_repayment | income
        "category": category,
        "known_at": known_at.isoformat(),
        "amount_status": amount_status,     # fixed | estimated | confirmed
        "description": description,
        "loan_id": loan_id,
    }


class PlanBuilder:
    """Helper that adds planned transactions and their *knowledge records*.

    Recurring bills/repayments become ``scheduled_events`` that are known some
    days before they fall due (``notice_days``); realised amounts may differ
    from the scheduled amount when ``amount_status == 'estimated'``.
    """

    def __init__(self, data: CustomerData, primary: str, start: date):
        self.data = data
        self.primary = primary
        self.start = start
        self.plan: list[dict[str, Any]] = []
        self._se = 0

    def add(self, day: date, kind: str, amount_aud: float | int, category: str, **extra: Any) -> None:
        amt = extra.pop("amount_cents", None)
        self.plan.append({"date": day, "kind": kind,
                          "amount_cents": amt if amt is not None else cents(amount_aud),
                          "category": category, "seq": len(self.plan), **extra})

    def commitment(self, day: date, kind: str, amount_aud: float, category: str, *,
                   description: str, scheduled_aud: float | None = None, amount_status: str = "fixed",
                   loan_id: str | None = None, notice_days: int = 35, known_at: date | None = None) -> None:
        """A bill / repayment: planned transaction + known scheduled event."""
        self.add(day, kind, amount_aud, category, description=description, loan_id=loan_id)
        self._se += 1
        event_type = {"essential": "bill", "loan": "loan_repayment", "card": "card_repayment"}[kind]
        if known_at is None:
            known_at = max(self.start, day - timedelta(days=notice_days))
        self.data.scheduled_events.append(scheduled(
            self.data.customer_id, self.primary, self._se, day,
            cents(scheduled_aud if scheduled_aud is not None else amount_aud),
            event_type, category, known_at, amount_status, description, loan_id))

    def confirmed_income(self, day: date, amount_aud: float, category: str, source_id: str,
                         known_at: date, description: str) -> None:
        self._se += 1
        self.data.scheduled_events.append(scheduled(
            self.data.customer_id, self.primary, self._se, day, cents(amount_aud), "income",
            category, known_at, "confirmed", description, None) | {"income_source_id": source_id})
