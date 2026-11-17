"""Central configuration: dates, seeds, versions and DEMONSTRATION thresholds.

Every threshold below is an illustrative MVP setting chosen for a synthetic
demo. None of them is Westpac policy, regulatory guidance or a validated
credit-risk cut-off.
"""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

# ---------------------------------------------------------------- paths
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
MODELS_DIR = ROOT / "models"
DB_PATH = DATA_DIR / "careloop.db"
SNAPSHOTS_CSV = DATA_DIR / "feature_snapshots.csv"
MODEL_PATH = MODELS_DIR / "synthetic_repayment_model.joblib"
METRICS_PATH = MODELS_DIR / "metrics.json"
FEATURE_SCHEMA_PATH = MODELS_DIR / "feature_schema.json"

# ---------------------------------------------------------------- versions / seeds
GENERATOR_VERSION = "careloop-sim-1.0.0"
FEATURE_VERSION = "careloop-features-1.0.0"
MODEL_VERSION = "careloop-synthetic-lr-1.0.0"
DEFAULT_SEED = 42
DEFAULT_COHORT_SIZE = 1000

# ---------------------------------------------------------------- calendar
AS_OF_DATE = date(2026, 11, 16)            # illustrative "today"
HISTORY_DAYS = 180                          # simulated history ending on AS_OF_DATE
HISTORY_START = AS_OF_DATE - timedelta(days=HISTORY_DAYS - 1)
FUTURE_DAYS = 35                            # realised future simulated after AS_OF_DATE
SIM_END = AS_OF_DATE + timedelta(days=FUTURE_DAYS)
CURRENCY = "AUD"

# ---------------------------------------------------------------- feature windows
RECENT_WEEKS = 4
BASELINE_WEEKS = 12
MIN_BASELINE_WEEKS = 8
MIN_HISTORY_DAYS = 84                       # below this -> data_quality insufficient/partial
CASHFLOW_WINDOW_DAYS = 30

# ---------------------------------------------------------------- rules engine (demo settings)
LOOKAHEAD_DAYS = 14
WARNING_BUFFER_DAYS = 14                    # cash buffer below this = LOW_BUFFER
AMPLE_BUFFER_DAYS = 90                      # reserves this large neutralise flow-based signals
LOW_COVERAGE_RATIO = 1.1
INCOME_DROP_THRESHOLD = -0.20               # vs the customer's OWN baseline
BALANCE_DECLINE_PCT = -0.25
BALANCE_DECLINE_MIN_AUD = 200.0
INCOME_OVERDUE_RATIO = 1.5                  # gap > 1.5x personal cadence
MIN_WARNING_SIGNALS_FOR_TIER1 = 2
CONSERVATIVE_INCOME_QUANTILE = 0.20
CONSERVATIVE_BILL_UPLIFT = 1.10             # estimated bills +10% in stress scenario

# Configurable, UNVERIFIED policy placeholder (do not present as legal advice).
SUPPORT_REQUEST_RESPONSE_DAYS_POLICY = 21

# ---------------------------------------------------------------- ML experiment
SNAPSHOT_MIN_HISTORY_DAYS = 90
SNAPSHOT_STEP_DAYS = 7
LABEL_HORIZON_DAYS = 14
TEST_SIZE = 0.20

# ---------------------------------------------------------------- categories
INCOME_CATEGORIES = {"salary", "wages", "pension", "benefit", "client_invoice", "other_income"}
ESSENTIAL_CATEGORIES = {"rent", "groceries", "utilities", "transport", "insurance", "phone_internet"}
VARIABLE_ESSENTIAL_CATEGORIES = {"groceries", "transport"}
REPAYMENT_CATEGORIES = {"loan_repayment", "card_repayment"}
DISCRETIONARY_CATEGORIES = {"dining", "entertainment", "shopping"}
INTERNAL_CATEGORIES = {"transfer_internal"}
NON_INCOME_INFLOW_CATEGORIES = {"transfer_external_own", "refund"}
EXCLUDED_FROM_CASHFLOW = INTERNAL_CATEGORIES | {"reversal"}

TIER_LABELS = {0: "Steady", 1: "Squeezed", 2: "At risk", 3: "In difficulty"}
SPECIALIST_LABEL = "Tier 4 — Needs special care"

SYNTHETIC_DISCLAIMER = (
    "This model was trained and evaluated only on synthetically simulated financial "
    "histories. Its score describes the simulator's patterns, not a validated "
    "probability of hardship or missed payments for real Australian bank customers."
)
DEMO_NOTICE = (
    "Fictional customers and simulated transactions only. Thresholds are demonstration "
    "settings, not Westpac policy. Staff, not software, decide hardship arrangements."
)
