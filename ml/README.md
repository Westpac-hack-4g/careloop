# CareLoop — Synthetic Banking Simulator + Explainable Repayment-Risk MVP

> **Synthetic proof of concept.** All customers, accounts and transactions are fictional and simulated.
> Thresholds are demonstration settings, **not Westpac policy**. Westpac staff, not software, decide hardship
> arrangements. No real banking connection, personal data, notification or hardship decision exists here.
>
> **ML disclaimer:** This model was trained and evaluated only on synthetically simulated financial histories.
> Its score describes the simulator's patterns, **not a validated probability of hardship or missed payments
> for real Australian bank customers**.

CareLoop follows the *CareLoop Explained Simply* journey: **notice early → make asking for help easy → follow
through**. The first demo centres on **Sarah**: CareLoop finds a projected **AUD 620 shortfall on 28 Nov 2026**,
explains why, and offers optional help.

---

## 1. Quick start (Windows PowerShell in VS Code)

Open the `CareLoop` folder in VS Code, then open a terminal (**Terminal → New Terminal**, PowerShell):

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python scripts/generate_data.py --customers 1000 --seed 42
python scripts/build_features.py
python scripts/train_model.py
python scripts/check_demo.py
python -m pytest -q
python -m streamlit run app.py
```

For the API, open a **second** terminal (click **+** in the terminal panel), activate the venv again, then run:

```powershell
.venv\Scripts\Activate.ps1
python -m uvicorn api:app --reload --port 8000
```

Interactive API docs: <http://localhost:8000/docs>. Streamlit opens at <http://localhost:8501>.

**Tips:**
- If PowerShell blocks `Activate.ps1`, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.
- In VS Code, press **Ctrl+Shift+P → Python: Select Interpreter** and choose `.venv`, so the Run button and Testing panel use the project environment.
- The four demo customers are built in memory, so `check_demo.py`, the app and the API all work **before** you generate data. Generating data adds the 1,000-customer cohort, the "Random synthetic customer" option and the ML model.
- `generate_data.py` takes about 20 s, `build_features.py` about 35 s and `train_model.py` about 15 s on a laptop CPU.

| Command | Arguments | Output |
|---|---|---|
| `scripts/generate_data.py` | `--customers N` (default 1000), `--seed S` (default 42) | `data/careloop.db` (SQLite) |
| `scripts/build_features.py` | `--out PATH` (default `data/feature_snapshots.csv`) | snapshots CSV + `feature_snapshots` table |
| `scripts/train_model.py` | `--snapshots PATH`, `--seed S` | `models/synthetic_repayment_model.joblib`, `models/metrics.json`, `models/feature_schema.json` |
| `scripts/check_demo.py` | – | prints tiers, signals, Sarah's shortfall; exit code 1 if an expectation fails |

---

## 2. Architecture

```text
careloop/
  config.py            dates, seeds, versions, DEMO thresholds
  ledger.py            CustomerData + accounting engine (integer cents; failed payments never debited)
  sample_customers.py  Alex, Tom, Tom (savings control), Sarah, Mia as raw dated event plans
  simulator.py         seeded 1,000-customer event-driven cohort (5 income patterns, shocks)
  features.py          as-of view (hard cut-off) + feature calculations with missing/quality flags
  forecast.py          14-day daily forecast: base + conservative scenarios, confidence
  tiers.py             auditable rules -> financial_tier 0..3, specialist routing, reason codes
  ml.py                time-safe snapshots, labels, grouped split, LR / HGB, artifacts, predict
  db.py                SQLite schema (FKs, indexes) and persistence
  schemas.py           Pydantic JSON contracts
  service.py           the ONE façade used by Streamlit and FastAPI
app.py                 Streamlit UI only (no business logic)
api.py                 FastAPI JSON layer only
scripts/  tests/  examples/NextJsCareLoopPanel.tsx  .env.example
legacy_hybrid_mvp/     earlier UCI credit-card prototype, kept separate and NOT used by this MVP
```

### Data design (no hard-coded risk)
- The generator creates **customers, accounts and dated transactions**. It never assigns a tier, a label or a feature value.
- Each day's events are applied in order (income → bills → repayments → discretionary spending). If funds are short, the ledger first sweeps money from linked savings (recorded on both sides as an internal transfer). If that still isn't enough, it records a **failed** payment and does not debit it. A failed loan or card attempt also writes a `repayment_outcomes` row.
- Bills and repayments become `scheduled_events` with a `known_at` date. Only events where `known_at <= as_of` can enter a forecast.
- Shocks (reduced hours, job loss, delayed wages, client loss, late invoices, utility increases, emergencies) live in `simulation_events`. They change transactions only and are never read by features.
- **Sarah's** events are constrained so that, as of 16 Nov, her balance is **$420**, her next estimated pay is **$900**, known bills before the repayment total **$940**, and her home-loan repayment of **$1,000** falls on 28 Nov. The **$620 gap is computed** by the forecast. Change any input and it recomputes (see `tests/test_forecast.py`).

### Features (`features.py`, only data up to `as_of`)
`income_change_pct`, `income_volatility`, `net_cash_flow_30d`, `cash_buffer_days`, `repayment_coverage_ratio`,
`projected_shortfall_14d` (from the forecast), `failed_loan_payments_30d` / `failed_other_payments_30d`,
`balance_change_30d` (mean balance over the last 7 days vs days −37..−8), `essential_expense_ratio`, and
`income_gap_days` / `income_gap_ratio` (measured against the customer's own cadence).

- **Income accrual:** each credit is spread over that source's own inferred pay cadence before weekly totals are computed. A regular fortnightly or monthly earner therefore doesn't look volatile or income-less just because a 7-day window missed a payday. When pay stops, the drop still shows within one cadence.
- **Missing income** gives `income_visibility = unknown/partial` and `assessment_status = insufficient_data`. It is never treated as zero income or job loss, and the customer can confirm their income manually.

### Forecast
- **Base:** current accessible balance, plus known bills and repayments, plus income estimated as the median of the last 3 pays at the personal cadence (or customer-confirmed income).
- **Conservative:** income at the 20th percentile of the last 6 pays, with overdue or irregular income assumed late. Estimated bills are raised 10%, and everyday essentials are added at the last-30-day daily rate.
- A shortfall counts as a *repayment* shortfall only on a scheduled loan or card due date.

### Rules (`tiers.py`, demonstration settings in `config.py`)
1. An explicit customer disclosure sets `specialist_support_required` and pauses alerts. It is never inferred from transactions.
2. An observed failed loan or card repayment in the last 30 days gives **Tier 3**.
3. Unknown or partial income visibility, or too little history, gives `insufficient_data` with no tier.
4. A **base-case** loan or card shortfall within 14 days gives **Tier 2**. A shortfall that appears only in the stress scenario counts as one warning signal.
5. Two or more early-warning signals give **Tier 1**. The signals are: `LOW_BUFFER`, `NEGATIVE_CASHFLOW`, `LOW_COVERAGE`, `BALANCE_DECLINE`, `INCOME_DROP`, `INCOME_OVERDUE`, `FAILED_OTHER_PAYMENTS` and `STRESS_SCENARIO_GAP`.
6. Otherwise **Tier 0**.

Income volatility and employment type never count as signals. If accessible funds cover at least 90 days of essentials, the cash-flow, coverage and balance-trend signals are reported but not counted (`RESERVES_COVER_DEFICIT`). This is why Tom's savings control stays at Tier 0.

---

## 3. Example analysis (computed from the generated event histories, as of 2026-11-16)

| Customer | Tier | Income vs own usual | Volatility | Net cash 30 d | Buffer | Coverage | Base-case gap | Reason codes |
|---|---|---|---|---|---|---|---|---|
| Alex | **0 Steady** | −1.2% | 0.05 | +$1,854 | 247 d | 2.15 | none | – |
| Tom | **1 Squeezed** | −8.5% | 0.10 | −$550 | 7.8 d | 1.12 | none | LOW_BUFFER, NEGATIVE_CASHFLOW, BALANCE_DECLINE |
| Sarah | **2 At risk** | −22.3% | 0.01 | −$723 | 5.1 d | 0.83 | **$620 on 2026-11-28** (stress: $947) | EXPECTED_REPAYMENT_GAP, LOW_BUFFER, NEGATIVE_CASHFLOW, LOW_COVERAGE, BALANCE_DECLINE, INCOME_DROP |
| Mia | **3 In difficulty** | −100% | – | −$626 | 1.1 d | 0.00 | $120 on 2026-11-25 | MISSED_REPAYMENT (10 Nov), LOW_BUFFER, … INCOME_OVERDUE, FAILED_OTHER_PAYMENTS |
| Tom (savings control) | **0 Steady** | −8.5% | 0.10 (same as Tom) | −$550 | 186 d | 1.12 | none | RESERVES_COVER_DEFICIT (informational) |

Run `python scripts/check_demo.py` to reproduce these numbers.

---

## 4. ML experiment (synthetic only)

- **Target:** `missed_repayment_next_14d`, which is 1 if the simulator recorded a failed loan or card repayment due in (t, t+14]. Snapshots with no repayment due in that window are **excluded**.
- **Snapshots:** taken weekly from day 90 of each customer's history, using past-only features. Profile type and the forecast shortfall are not used as features.
- **Split:** `GroupShuffleSplit` by `customer_id` (80/20, seed 42). Preprocessing happens inside each pipeline, and the threshold is chosen by maximising F1 on out-of-fold predictions within the training customers (5-fold `GroupKFold`).

**Results from the run in this repository** (`models/metrics.json`, 1,000 customers, seed 42):

| | Value |
|---|---|
| Customers (train / test) | 1,000 (800 / 200) |
| Candidate snapshots / excluded (no repayment due) / labelled | 16,000 / 6,635 / 9,365 |
| Positives / prevalence | 364 / 3.89% (test prevalence 5.0%) |

| Model (held-out customers) | ROC-AUC | PR-AUC | Brier | Precision | Recall | Threshold |
|---|---|---|---|---|---|---|
| Baseline (prevalence) | 0.50 | 0.050 | 0.048 | – | – | – |
| Logistic regression (selected) | 0.953 | 0.584 | 0.081 | 0.53 | 0.69 | 0.86 |
| HistGradientBoosting | 0.970 | 0.671 | 0.041 | 0.69 | 0.55 | 0.87 |

The logistic regression confusion matrix on the test set is TN 1733, FP 58, FN 29, TP 66.

**Caveats:**
- The high AUC is mostly a **simulator shortcut**, not real predictive skill. In the simulator a repayment fails exactly when accessible funds are short, so `cash_buffer_days` dominates (standardised coefficient −10.8).
- About 44% of positives already had a failed repayment in the previous 30 days.
- The logistic regression uses `class_weight="balanced"`, so its scores are inflated relative to prevalence. Treat them as rankings, not calibrated probabilities.
- Per-profile false-positive rates in the held-out simulation:

  | Profile | False-positive rate |
  |---|---|
  | Casual | 4.9% |
  | Freelancer | 3.1% |
  | Full-time | 2.1% |
  | Part-time | 7.1% |
  | Retiree | 0% |

  This is not evidence of real-world fairness.
- Your numbers will match exactly if you use the same seed and package versions.

---

## 5. API & website integration

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | status, model availability |
| GET | `/api/v1/demo/customers?include_cohort=false` | list fictional customers (`data_source: synthetic`) |
| GET | `/api/v1/demo/customers/{customer_id}` | profile, balances, recent transactions, known upcoming events (no analysis) |
| POST | `/api/v1/analysis` | full analysis; **403 `consent_required`** unless `consent_confirmed: true` |
| GET | `/api/v1/demo/model/metrics` | training metrics, or `not_trained` |

Request:

```json
{ "customer_id": "SARAH", "consent_confirmed": true, "as_of_date": "2026-11-16",
  "customer_disclosed_specialist_need": false,
  "customer_confirmed_income": [{ "date": "2026-11-20", "amount": 900 }] }
```

The last two fields are optional. The response is validated by `careloop.schemas.AnalysisResponse` and includes:
- `financial_tier`, `tier_label`, `assessment_status` and `specialist_support_required`;
- `reason_codes` and `reasons[]`;
- `features`, `missing_flags` and `data_quality`;
- `forecast`: the base scenario at the top level, with `shortfall_amount_aud`, `shortfall_date`, `assumptions`, 14 real `daily_balances` and `events`, plus `conservative`, `confidence` and `shortfall_range_aud`;
- `ml_experiment`: `model_status` and `predicted_probability`, or `null`;
- `recommended_action`, `support_journey` and `disclaimer`.

**Using it from the team's site:**
1. Run the API.
2. Set `NEXT_PUBLIC_CARELOOP_API_URL` in the website's `.env.local` (see `.env.example`).
3. Add your site's origin to `CARELOOP_ALLOWED_ORIGINS`. CORS is never `*`.
4. Render the JSON from `POST /api/v1/analysis`, as in `examples/NextJsCareLoopPanel.tsx`.

The site must **not** compute tiers or shortfalls itself; Streamlit and the API call the same `careloop.service.analyse_data`, and a test checks that they match.

**Deployment:** deploy only as a **synthetic demo**, for example a single container running `uvicorn api:app --host 0.0.0.0 --port 8000` with the demo customers. The API has **no authentication**, does not accept uploaded bank data, and must not be presented as a real bank service.

---

## 6. Tests

`python -m pytest -q` runs 49 tests covering:
- **Accounting:** reconciliation, failed repayments not debited, internal transfers not counted as income, seed determinism.
- **Time safety:** future transactions, shocks and outcomes don't change features at t.
- **Labels:** only observed failures in (t, t+14] count, and no-due snapshots are excluded.
- **Split:** no customer appears in both train and test.
- **Fairness controls:** the well-funded casual worker is Tier 0; the salaried worker with a credible gap is Tier 2; volatility alone raises nothing; missing income gives `insufficient_data`.
- **Demo outcomes:** each demo customer gets the expected tier.
- **Specialist routing:** set only by disclosure.
- **API:** consent gate, parity with the shared service, and CORS.
- **ML:** fallback when no model file exists.

## 7. Implemented vs deferred

**Implemented:**
- Event-driven simulator with five income patterns, shocks, savings sweeps and failed payments.
- SQLite schema.
- As-of features with quality flags.
- Two-scenario forecast.
- Rules engine with reason codes.
- Specialist routing.
- Customer-confirmed income.
- Synthetic ML experiment (baseline, logistic regression and gradient boosting).
- Streamlit tabs A–D.
- FastAPI.
- Next.js example.
- Tests.

**Deferred:**
- Real Open Banking/CDR connections and authentication.
- Arrears and retry modelling after a failed repayment.
- Partial repayments.
- Credit-card purchase ledgers (card repayments are modelled as fixed obligations, so they are never double-counted as spending).
- A later-in-time evaluation split.
- Probability calibration.
- An optimistic forecast scenario.
- Production RAG or LLM help, and live notifications.

## 8. Known limitations

- **Synthetic domain only:** the simulator's assumptions drive every result, including the ML metrics.
- **Unverified thresholds:** the thresholds and the 21-day response setting are unverified demo values.
- **Incomplete account observability:** income paid into another bank appears as "partial" visibility.
- **Irregular income:** forecasts for freelancers and casual workers carry wide uncertainty, which is shown as a range and a confidence level.
- **Prediction uncertainty:** the realised future can differ from the forecast. In the simulation, Sarah's actual 28 Nov repayment also fails, but that outcome is never visible at 16 Nov.

> CareLoop demonstrates how consent-based analysis of transaction patterns, short-term cash-flow scenarios and an
> experimental synthetic-data ML model can help identify potential repayment pressure. The pilot uses fictional
> customers; the model and thresholds would require real-world validation, fairness review, privacy assessment and
> human governance before any bank deployment.
