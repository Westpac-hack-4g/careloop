"""SQLite persistence (synthetic data only). Money stored as INTEGER cents."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Iterable

import pandas as pd

from . import config as C
from .ledger import CustomerData

SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS customers (
  customer_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, profile_type TEXT NOT NULL,
  data_source TEXT NOT NULL, consent_demo INTEGER NOT NULL DEFAULT 0, story TEXT,
  history_start TEXT NOT NULL, generator_version TEXT, simulation_parameters_json TEXT);
CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
  account_type TEXT NOT NULL, opening_balance_cents INTEGER NOT NULL, available_balance_cents INTEGER,
  accessible INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS income_sources (
  income_source_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
  source_type TEXT, expected_frequency TEXT, detection_method TEXT, confidence REAL, last_observed_at TEXT);
CREATE TABLE IF NOT EXISTS transactions (
  transaction_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
  posted_at TEXT NOT NULL, amount_cents INTEGER NOT NULL, category TEXT NOT NULL, direction TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('posted','failed')), counterparty_type TEXT,
  income_source_id TEXT, description TEXT, is_internal INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_tx_customer_date ON transactions(customer_id, posted_at);
CREATE TABLE IF NOT EXISTS scheduled_events (
  event_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE, due_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, event_type TEXT NOT NULL, category TEXT, known_at TEXT NOT NULL,
  amount_status TEXT NOT NULL, description TEXT, loan_id TEXT, income_source_id TEXT);
CREATE INDEX IF NOT EXISTS ix_se_customer_known ON scheduled_events(customer_id, known_at);
CREATE TABLE IF NOT EXISTS repayment_outcomes (
  outcome_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
  loan_id TEXT NOT NULL, due_date TEXT NOT NULL, attempted_at TEXT, amount_due_cents INTEGER NOT NULL,
  paid_amount_cents INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('success','failed','partial')));
CREATE INDEX IF NOT EXISTS ix_ro_customer_due ON repayment_outcomes(customer_id, due_date);
CREATE TABLE IF NOT EXISTS simulation_events (
  event_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
  event_date TEXT NOT NULL, event_type TEXT NOT NULL, parameters_json TEXT);
CREATE TABLE IF NOT EXISTS feature_snapshots (
  customer_id TEXT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE, as_of_date TEXT NOT NULL,
  features_json TEXT NOT NULL, missing_flags TEXT, feature_version TEXT NOT NULL,
  missed_repayment_next_14d INTEGER, PRIMARY KEY (customer_id, as_of_date));
CREATE TABLE IF NOT EXISTS risk_assessments (
  customer_id TEXT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE, as_of_date TEXT NOT NULL,
  financial_tier INTEGER, specialist_support_required INTEGER NOT NULL, reason_codes TEXT,
  shortfall_cents INTEGER, ml_prediction REAL, model_version TEXT, PRIMARY KEY (customer_id, as_of_date));
"""


def connect(path: Path = C.DB_PATH) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def reset(path: Path = C.DB_PATH) -> None:
    if path.exists():
        path.unlink()
    with connect(path) as con:
        con.executescript(SCHEMA)


def _insert(con, table: str, rows: list[dict[str, Any]], cols: list[str]) -> None:
    if rows:
        con.executemany(f"INSERT INTO {table} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                        [tuple(r.get(c) for c in cols) for r in rows])


def save_customers(customers: Iterable[CustomerData], path: Path = C.DB_PATH, meta: dict | None = None) -> int:
    n = 0
    with connect(path) as con:
        con.executescript(SCHEMA)
        for d in customers:
            c = d.customer
            con.execute("INSERT OR REPLACE INTO customers VALUES (?,?,?,?,?,?,?,?,?)",
                        (c["customer_id"], c["display_name"], c["profile_type"], c["data_source"],
                         int(c.get("consent_demo", False)), c.get("story"), c["history_start"],
                         c.get("generator_version"), json.dumps(c.get("simulation_parameters", {}))))
            _insert(con, "accounts", [a | {"accessible": int(a.get("accessible", True))} for a in d.accounts],
                    ["account_id", "customer_id", "account_type", "opening_balance_cents",
                     "available_balance_cents", "accessible"])
            _insert(con, "income_sources", d.income_sources,
                    ["income_source_id", "customer_id", "source_type", "expected_frequency", "detection_method",
                     "confidence", "last_observed_at"])
            _insert(con, "transactions", [t | {"is_internal": int(t["is_internal"])} for t in d.transactions],
                    ["transaction_id", "account_id", "customer_id", "posted_at", "amount_cents", "category",
                     "direction", "status", "counterparty_type", "income_source_id", "description", "is_internal"])
            _insert(con, "scheduled_events", d.scheduled_events,
                    ["event_id", "customer_id", "account_id", "due_date", "amount_cents", "event_type", "category",
                     "known_at", "amount_status", "description", "loan_id", "income_source_id"])
            _insert(con, "repayment_outcomes", d.repayment_outcomes,
                    ["outcome_id", "customer_id", "loan_id", "due_date", "attempted_at", "amount_due_cents",
                     "paid_amount_cents", "status"])
            _insert(con, "simulation_events", d.simulation_events,
                    ["event_id", "customer_id", "event_date", "event_type", "parameters_json"])
            n += 1
        for k, v in (meta or {}).items():
            con.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", (k, json.dumps(v)))
    return n


def _rows(con, sql: str, *args) -> list[dict[str, Any]]:
    return [dict(r) for r in con.execute(sql, args).fetchall()]


def load_customer(customer_id: str, path: Path = C.DB_PATH) -> CustomerData | None:
    if not path.exists():
        return None
    with connect(path) as con:
        c = _rows(con, "SELECT * FROM customers WHERE customer_id=?", customer_id)
        if not c:
            return None
        cust = c[0]
        cust["consent_demo"] = bool(cust["consent_demo"])
        cust["simulation_parameters"] = json.loads(cust.pop("simulation_parameters_json") or "{}")
        accounts = [a | {"accessible": bool(a["accessible"])}
                    for a in _rows(con, "SELECT * FROM accounts WHERE customer_id=?", customer_id)]
        txs = [t | {"is_internal": bool(t["is_internal"])}
               for t in _rows(con, "SELECT * FROM transactions WHERE customer_id=? ORDER BY posted_at, transaction_id",
                              customer_id)]
        return CustomerData(cust, accounts, txs,
                            _rows(con, "SELECT * FROM income_sources WHERE customer_id=?", customer_id),
                            _rows(con, "SELECT * FROM scheduled_events WHERE customer_id=?", customer_id),
                            _rows(con, "SELECT * FROM repayment_outcomes WHERE customer_id=?", customer_id),
                            _rows(con, "SELECT * FROM simulation_events WHERE customer_id=?", customer_id))


def load_all(path: Path = C.DB_PATH, data_source: str | None = "synthetic") -> list[CustomerData]:
    if not path.exists():
        return []
    with connect(path) as con:
        ids = [r["customer_id"] for r in con.execute(
            "SELECT customer_id FROM customers" + (" WHERE data_source=?" if data_source else "") +
            " ORDER BY customer_id", (data_source,) if data_source else ())]
    return [load_customer(i, path) for i in ids]


def list_customers(path: Path = C.DB_PATH, data_source: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    with connect(path) as con:
        sql = "SELECT customer_id, display_name, profile_type, data_source FROM customers"
        args: tuple = ()
        if data_source:
            sql += " WHERE data_source=?"
            args = (data_source,)
        return _rows(con, sql + " ORDER BY customer_id LIMIT ?", *args, limit)


def save_snapshots(df: pd.DataFrame, feature_cols: list[str], path: Path = C.DB_PATH) -> None:
    with connect(path) as con:
        con.execute("DELETE FROM feature_snapshots")
        con.executemany("INSERT INTO feature_snapshots VALUES (?,?,?,?,?,?)", [
            (r.customer_id, r.as_of_date, json.dumps({c: (None if pd.isna(getattr(r, c)) else float(getattr(r, c)))
                                                      for c in feature_cols}),
             r.missing_flags, r.feature_version, int(r.missed_repayment_next_14d))
            for r in df.itertuples(index=False)])


def read_meta(path: Path = C.DB_PATH) -> dict[str, Any]:
    if not path.exists():
        return {}
    with connect(path) as con:
        try:
            return {r["key"]: json.loads(r["value"]) for r in con.execute("SELECT key, value FROM meta")}
        except sqlite3.OperationalError:
            return {}
