# CareLoop — Claude Implementation Brief

**Project:** Synthetic Banking Data Simulator + Explainable Repayment-Risk MVP  
**Delivery:** Working Streamlit demo now; reusable FastAPI backend for integration into the team's website later  
**Audience:** Claude Code / coding assistant working in a Python repository  
**Status:** Implementation specification for a **synthetic proof of concept**, **not** a bank-deployed or clinically/financially validated risk model  
**Date:** 16 November 2026 (Australia/Brisbane)

---

## 0. Instructions to Claude — read first

You are the lead Python / data science engineer implementing CareLoop. **Build working, runnable code, not just an architecture sketch or a notebook.** Work in small, testable increments and keep modules clean enough to attach to a React/Next.js website later.

**Key requirements:**

1. Generate **synthetic customers and raw, dated bank transactions**; never assign a risk tier directly in the data generator.
2. Simulate **actual scheduled loan payments and their realised success/failure**. Use these observed *future simulation outcomes* as ML training labels, not a hand-written risk score.
3. Compute all behavioural features **only using information available on or before a chosen `as_of_date`**. Future realised salary or events must **never leak into predictors**.
4. Support **regular, part-time, casual, freelance and retirement income patterns**. Variability is **not automatically evidence of hardship**.
5. Build an **explainable rules engine** for the demo's customer-support tiers. Train an **independent experimental ML model** to predict future simulated repayment failure; display its predictions separately, with a prominent synthetic-data disclaimer. The ML score must **not** silently determine the support tier.
6. Create a Streamlit interface which calls reusable Python domain services, plus a FastAPI service with JSON response contracts so the team's site can reuse exactly the same calculations.
7. **No real banking connections, real personal data, live customer notifications, hardship approval/decline, or claims of validated real-world predictive performance.**
8. Prioritise a reliable end-to-end Sarah demonstration over feature creep.

If a `CareLoop_Hybrid_MVP` codebase exists, inspect it first and **reuse useful code where appropriate**. Do not assume its old UCI card-default model represents our new synthetic transaction ML model; keep any legacy UCI work separate and clearly labelled, or leave it out of the MVP.

**Definition of success:** On a clean machine, one setup command plus documented launch commands produce a functioning Streamlit app with Alex, Tom, Sarah and Mia; a repeatable simulator; genuine calculated financial features; a trained synthetic research classifier (if training is enabled); usable API endpoints; and passing tests.

---

## 1. Product context: preserve the existing CareLoop proposal

The existing **CareLoop Explained Simply** proposal describes a helper within a signed-in Westpac app that:

1. **Notices early:** detects changes in the customer's financial situation, with consent, *before* a repayment is missed.
2. **Makes asking for help easy:** explains the concern, answers questions using approved Westpac information and helps prepare a support request that the customer checks.
3. **Follows through:** shows request status and supports the customer until the matter is resolved.

**Important guardrails from the proposal:**

- **Westpac staff decide** hardship arrangements. AI must never approve or decline them.
- The customer can start asking for help **without an automated alert**.
- Early heads-up alerts are **opt-in**, discreet and controlled by notification rules.
- Handle **sensitive disclosures** through a separate specialist path, not financial-transaction profiling.
- The first demo must focus on **Sarah's journey**, especially detecting a **$620 expected shortfall on 28 November 2026**, showing why, and offering help.
- Preserve Tom and Mia as supporting customers and add Alex as a stable comparison.
- The proposal describes a request/response deadline workflow. For this technical MVP, treat any claimed legal response time (e.g. 21 days) as a **configurable, unverified policy setting**; do not present it as verified legal advice in generated code.

### Existing tier nomenclature

| Tier | Name | Meaning in proposal | Initial response |
|---|---|---|---|
| 0 | Steady | Payments appear comfortably covered | No unsolicited alert |
| 1 | Squeezed | Financial pressure is emerging but payments are still being made | Optional money check |
| 2 | At risk | A repayment shortfall is expected soon | Early, consent-based support guidance |
| 3 | In difficulty | A payment has already been missed | Immediate option to contact assistance |
| 4 | Needs special care | A sensitive situation is disclosed | **Separate specialist routing**, pause automated alerts |

**Clarification:** Tier 4 is **not** a greater numerical financial risk than Tier 3. For implementation, model `financial_tier` as `0..3` and `specialist_support_required` as a **separate boolean / routing status**. The UI may display the proposal's label “Tier 4 — Needs special care” for continuity, but must not calculate it from account spending.

---

## 2. Architecture and scope

```text
                        SYNTHETIC DATA PIPELINE
                 ┌───────────────────────────────┐
                 │ Customer profiles + accounts  │
                 │ Income, bills, shocks, loans  │
                 └───────────────┬───────────────┘
                                 │ simulate days
                  ┌──────────────▼──────────────┐
                  │ Dated raw transactions      │
                  │ balances / scheduled events │
                  │ repayment success / failure │
                  └──────────────┬──────────────┘
                                 │
                  ┌──────────────▼──────────────┐
                  │ SQLite (synthetic only)     │
                  └──────┬───────────┬──────────┘
                         │           │
            as_of_date   │           │ future 14-day observed outcomes
                  ┌──────▼────┐ ┌───▼────────────────┐
                  │ Features  │ │ Training targets   │
                  │ up to t   │ │ (t, t+14]         │
                  └──────┬────┘ └───┬────────────────┘
                         │          │
                         ├──────────▼─────────────┐
                         │ ML research model     │
                         │ simulated repayment   │
                         │ failure probability   │
                         └──────┬─────────────────┘
                                │ (display separately)
                  ┌─────────────▼─────────────────┐
                  │ Financial analysis / forecast│
                  │ Rules-based support routing  │
                  └─────────────┬─────────────────┘
                                │
                ┌───────────────▼────────────────┐
                │ Shared domain service         │
                └───────────────┬────────────────┘
                     ┌──────────┴──────────┐
                Streamlit demo        FastAPI JSON
                                         │
                                    Team website
``` 

**Stack:** Python 3.11+, pandas, numpy, scikit-learn, Streamlit, FastAPI, Pydantic, SQLite (`sqlite3` or SQLAlchemy), Plotly/Altair, pytest, joblib. CPU only; no paid API keys.

**Out of scope for one-day build:** real Open Banking/CDR connections, authenticated Westpac access, payment execution, production-grade RAG/LLM agent, automated hardship decisions, live notifications, deployable risk scoring for real people.

---

## 3. Synthetic data design: event-driven, not arbitrary risk labels

### 3.1 Size and dates

- **Initial showcase:** 4 deterministic named demo customers (`Alex`, `Tom`, `Sarah`, `Mia`).
- **Model training experiment:** default **1,000 synthetic customers**, seeded (`random_state=42`). Make count configurable.
- Simulate **180 historical days** per customer, plus enough days to observe labels for each eligible snapshot. The illustrative current date is **2026-11-16**.
- Use **AUD** for all customer-facing figures; ISO date strings (`YYYY-MM-DD`); signed amounts: credits positive, debits negative.
- Provide deterministic reruns; print generator configuration/version and seed.
- Do not randomly balance the classes by assigning labels. If simulated failures are rare, report prevalence and use appropriate metrics/class weighting.

### 3.2 Income patterns

Create a configurable customer profile with `income_pattern_type` used **only to govern simulated transactions and reasonable forecasting assumptions**, not as a direct negative risk feature.

| Profile | Example payment pattern | Variation to simulate |
|---|---|---|
| Full-time | weekly, fortnightly or monthly, mostly regular pay | small variation; occasional sudden reduced hours / job loss |
| Part-time | regular payday, variable pay amount | shift/hour changes, changing average earnings |
| Casual | weekly/fortnightly credits, substantially variable amount | shift volatility, sometimes low but normal weeks |
| Freelancer | intermittent client invoices, variable amount and date | late invoices, income gaps, multiple payers |
| Retiree / benefit recipient | regular pension or benefit deposit | relatively regular deposits, unexpected essential expense |

Simulate **positive controls** deliberately: some casual/freelance customers with volatile earnings but **large savings and uninterrupted repayments**. Also include customers with stable income who face high fixed costs and repayment pressure.

**Do not equate** lack of a visible salary credit with unemployment. A customer may receive income in another bank; flag `income_observability = unknown/partial/adequate` where applicable.

### 3.3 Realistic dated events

At minimum generate:

- Income credits: salary, other work income, pension/benefit, client invoice payments. Mark whether verified/simulated payroll or merely *inferred* from a transaction pattern.
- Essential debits: rent/mortgage, groceries, utilities, transport, insurance, phone/internet.
- Discretionary spending: dining, entertainment, shopping. **Do not infer sensitive characteristics from merchant names.**
- Loan/card repayment events with planned **due date**, expected amount, actual attempt, actual success or failure.
- Optional savings transfers: internal transfers must **not** increase total income or total household expenses.
- Exogenous changes: reduced shifts, delayed wages, loss of client work, increased utility costs, large emergency expenses. These affect **transactions**, not direct risk classes.

Preserve **accounting consistency**:

1. Choose starting account balances.
2. Apply successful posted credits/debits in chronological order.
3. Reconcile ending balance to starting balance plus posted transaction amounts.
4. If there are insufficient available funds when a scheduled loan repayment is attempted (and no simulated overdraft/credit facility), create an unsuccessful **repayment event** and **do not debit** the balance.
5. Account for any explicit transfers between accounts on both sides, and avoid double-counting credit card payments as fresh consumption when purchases were already included.
6. If expenses cannot be paid, either simulate their documented failed payment or an explicit alternative (e.g. draw from a linked accessible savings account). Do not silently allow unlimited negative cash.
7. Differentiate **known scheduled events**, **estimated future cash flows** and **future realised simulation outcomes**.

### 3.4 Two distinct future timelines

At prediction date `t`, the system is allowed to know:

- past posted transactions up to `t`;
- current available funds and any other **known accessible** balances;
- known loan repayment amounts/dates and fixed bills;
- historical income cadence and a probabilistic/conservative estimate of *future* income;
- customer-disclosed information available by `t`.

It is **not** allowed to know:

- future realised pay amounts;
- future shocks that are not yet disclosed;
- actual future repayment outcomes;
- a preassigned hardship tier.

Use the **realised future simulation** only to generate `missed_repayment_next_14d` labels and to check retrospective forecasts.

---

## 4. Database / data contracts

Use SQLite with proper foreign keys and indexes. Preferred tables:

| Table | Suggested fields | Notes |
|---|---|---|
| `customers` | `customer_id`, `display_name`, `profile_type`, `data_source`, `consent_demo` | Synthetic identifiers only; `profile_type` for simulation/UX, not automatic disadvantage |
| `accounts` | `account_id`, `customer_id`, `account_type`, `opening_balance`, `available_balance` | Optional second savings account |
| `transactions` | `transaction_id`, `account_id`, `posted_at`, `amount`, `category`, `direction`, `status`, `counterparty_type`, `income_source_id` | A failed repayment is an event, **not** a posted debit |
| `income_sources` | `income_source_id`, `customer_id`, `source_type`, `expected_frequency`, `detection_method`, `confidence`, `last_observed_at` | Explicit vs inferred income; no imaginary salary |
| `scheduled_events` | `event_id`, `customer_id`, `account_id`, `due_date`, `amount`, `event_type`, `known_at`, `amount_status` | Only `known_at <= as_of_date` can enter prediction |
| `repayment_outcomes` | `outcome_id`, `customer_id`, `loan_id`, `due_date`, `attempted_at`, `amount_due`, `paid_amount`, `status` | `success`, `failed`, `partial`; future outcomes define labels |
| `feature_snapshots` | `customer_id`, `as_of_date`, named features, `missing_flags`, `feature_version` | One row per customer and date |
| `risk_assessments` | `customer_id`, `as_of_date`, `financial_tier`, `specialist_support_required`, `reason_codes`, `shortfall`, `ml_prediction`, `model_version` | May be recomputed or cached |
| `simulation_events` | `event_id`, `customer_id`, `event_date`, `event_type`, `parameters_json` | Internal test/debug; do **not** feed undisclosed events into features |

Store monetary figures with decimal-safe representation or integer cents when possible. If floating point is used, round only at display boundaries; test reconciliation tolerances.

**Sample transaction row:**

```json
{
  "transaction_id": "TX-10001",
  "account_id": "ACC-SARAH-1",
  "posted_at": "2026-11-06",
  "amount": 650.00,
  "category": "salary",
  "direction": "credit",
  "status": "posted",
  "counterparty_type": "employer",
  "income_source_id": "INC-SARAH-1"
}
```

Keep JSON representation stable between Streamlit, FastAPI and future website. Add Pydantic schemas for inputs/outputs.

---

## 5. Feature engineering: calculate from raw history

Compute these **using only transactions/known data by `as_of_date`**. Implement independently testable functions and return value **plus** data-coverage/quality flags. Never inject feature values by hand.

| Feature name | Calculation / definition | Why it matters |
|---|---|---|
| `income_change_pct` | `(recent_weekly_equivalent_income - personal_baseline_weekly_income) / baseline_weekly_income`. Recent = last 4 completed weeks; baseline = preceding 8–12 non-overlapping weeks. If denominator absent/zero, use `null` and flag. | Change vs **own normal**, not other workers |
| `income_volatility` | `std(weekly_inflows_baseline) / mean(weekly_inflows_baseline)` over 8–12 prior completed weeks; handle zeros/missing. | Forecast uncertainty, **not automatic risk** |
| `net_cash_flow_30d` | Sum eligible posted external cash inflows + outflows in prior 30 days; exclude internal transfers and reversals. | Liquidity deterioration |
| `cash_buffer_days` | Total *accessible liquid funds* / `(past-30-day essential cash outflows / 30)`. Handle no/unknown essential outflow. | How long essential costs are covered without new income |
| `repayment_coverage_ratio` | Conservative expected income for the next 30 days / known fixed essential bills plus required loan/card payments for the same 30 days. | Financial obligation coverage; denominator must be meaningful |
| `projected_shortfall_14d` | Derived from daily **known/estimated** 14-day forecast at repayment due dates; report **maximum** shortage and associated date. | Main customer-facing early alert |
| `failed_payments_30d` | Count observed unsuccessful payment attempts in previous 30 days, separating loan/card vs other automatic debit failures. | Evidence of difficulty |
| `balance_change_30d` | Compare recent 7-day average end-of-day balances to an earlier period (e.g. days −37..−8) rather than a single payday snapshot; document choice. | Persistent declining balance trend |
| `essential_expense_ratio` | Essential spending over last 30 days / known external income over same 30 days; return `null` if income not observed. | Affordability pressure |
| `income_gap_days` | Days since latest observed income, interpreted **relative to personal expected cadence**; unknown income must be flagged, not treated as job loss. | Unexpected missing deposit |

**Implementation priority:** First eight; add last two after core flow works. `projected_shortfall_14d` is a **derived forecast output**, not necessarily an ML input in the initial experiment. It may be fed into a later model **only if calculated entirely from information available at t**, with appropriate validation.

### Casual/part-time/freelance accommodation

- The customer's income history defines the baseline; **never compare everyone with a fixed $800/week standard**.
- For uneven income, use a **robust rolling median**, lower quantile (e.g. 20th percentile) and historical income variability to create **base** and **conservative** future scenarios.
- **High income volatility alone must not raise a tier.** It widens uncertainty / changes the confidence of income estimates.
- A missing payday should be judged against an **inferred personal cadence**, and source/coverage confidence.
- An irregular-income person with high cash reserves and covered repayments should remain **Tier 0** even if CV is high.
- An employee with fixed income can still be Tier 2 if the next payment cannot be covered.
- Where there are fewer than about 8–12 usable weeks or incompletely observed accounts, return an explicit `data_quality: insufficient` / `income_visibility: partial` as appropriate; offer manual entry/confirmation instead of falsely assigning Tier 0 or Tier 2.
- To avoid unfairness in the simulator, distribute negative shocks and financial resilience across income types. Track per-profile false positive rates *in simulation*; do not claim this establishes real-world fairness.

### Forecast design

- Forecast **daily balance** for days `t+1` to `t+14`.
- Start from **currently accessible** balance. Apply bills and loan due dates chronologically. Apply only explicitly confirmed upcoming pay as a *known* event; otherwise estimate income using **historical cadence** with a marked assumption.
- Produce **base** and **conservative** scenarios (optional optimistic scenario later), including a **forecast confidence** flag.
- Report `shortfall_amount`, `shortfall_date`, `planned_repayment`, `assumptions` and an auditable sequence of forecast events.
- Do not label all negative balances as failed *loan repayment* unless the negative projection is on a **scheduled loan/card due date**.
- When income is highly uncertain, display a **range / conditional forecast** rather than a guaranteed $ figure.

---

## 6. Support-tier rules (separate from ML)

Implement a deterministic, auditable rule engine for **fictional customers only**, with reason codes and threshold constants in `config.py`:

```python
# Illustrative MVP thresholds only — not Westpac policy.
WARNING_BUFFER_DAYS = 14
LOW_COVERAGE_RATIO = 1.1
LOOKAHEAD_DAYS = 14
```

Priority:

1. If the **customer explicitly discloses** a specialist situation, set `specialist_support_required = True`, pause unsolicited alerts and offer specialist handover. This is **not inferred** from account transactions.
2. Else if an **actual loan/card repayment has already failed** or is confirmed overdue as of `t`, set `financial_tier = 3`.
3. Else if a **base-case** projected loan/card shortfall occurs in the next 14 days using sufficiently known/credible inputs, set `financial_tier = 2`. When only a low-income **stress scenario** shows a gap, communicate uncertainty and do not automatically treat it as a certain Tier 2 event.
4. Else if **two or more independently meaningful early-warning signals** occur — examples: low buffer, repeated negative cash flow, low obligation coverage, sustained balance deterioration — set `financial_tier = 1`.
5. Else `financial_tier = 0` **only if** sufficient account information exists.
6. If required data are missing, output `assessment_status = "insufficient_data"` and ask for customer confirmation; do **not** silently default to a tier.

`income_volatility` and employment type **alone** cannot elevate a tier. Use `reason_codes` such as `LOW_BUFFER`, `NEGATIVE_CASHFLOW`, `EXPECTED_REPAYMENT_GAP`, `MISSED_REPAYMENT`, `PARTIAL_INCOME_VISIBILITY`. Hard-coded thresholds must be described as demonstration settings.

**ML output:** Model probability is shown independently in an **Experimental ML** panel and may prompt the team to explore a scenario, but it must **not automatically override** this transparent rules engine. No synthetic training score is presented as a real risk probability.

---

## 7. ML training: simulated future repayment failure

### The task

`target = missed_repayment_next_14d` (binary)

For an observation `(customer_id, as_of_date=t)`:

- `X(t)` = features extracted **up to and including** t.
- `y(t)` = **1 if the simulator records an actual loan/card repayment failure** during `(t, t+14 days]`; **0 otherwise** if an observable repayment opportunity occurs and is fully covered.
- If **there is no repayment due in the horizon**, **exclude this snapshot** from the first binary experiment (or separately model a different target). Otherwise the majority of easy zeros could simply mean “no payment due”.
- Never set `y` from a risk tier, model score, or a future forecast created with oracle income.

### Snapshot generation

- After simulating each complete customer's history, select eligible `as_of_date` values with at least ~90 days of prior history and fully observed 14-day futures.
- Extract **past-only** feature snapshots; later join to **future realised** repayment outcome labels.
- There may be multiple snapshots per customer; **keep all snapshots for a customer in one split** to avoid identity leakage.
- Also add negative controls and money shocks for model robustness.

### Models & evaluation

- **Baseline:** always predict training prevalence or a simple constant.
- **Model A:** `SimpleImputer + StandardScaler + LogisticRegression` (possibly `class_weight='balanced'`; note calibration implications).
- **Model B (optional):** RandomForestClassifier or HistGradientBoostingClassifier.
- Split **by customer_id** into train/test (e.g. 80/20) with a fixed seed; if evaluating multiple snapshots, use group-based splitting. An additional later-time evaluation is a stretch goal.
- Do preprocessing **inside each training pipeline**; never impute/scale using all data before splitting.
- Report number of customers, snapshots, repayment opportunities, positive-label count/prevalence, ROC-AUC, **average precision / PR-AUC**, recall, precision, confusion matrix at a documented threshold and **Brier score** if probabilities are reported.
- Choose any classification threshold on training/validation, **not** the held-out test set. A perfectly high metric is a warning to check leakage or simulator shortcuts.
- Show feature coefficients/importances with a prominent caveat: they explain the **synthetic simulator**, not real credit decision drivers.
- Persist `models/synthetic_repayment_model.joblib`, `models/metrics.json`, `models/feature_schema.json`, seed and generator version.
- If model not trained, app must show **“Experimental ML model not available”**, not a fabricated percentage.

**Critical honesty statement in both README and UI:**

> This model was trained and evaluated only on synthetically simulated financial histories. Its score describes the simulator's patterns, **not a validated probability of hardship or missed payments for real Australian bank customers**.

---

## 8. Four deterministic demo customers

**Use raw events and the shared calculations to obtain all displayed features and tiers.** For reproducible customer demos, constrain the *underlying synthetic events* where needed; never inject the final tier or `projected_shortfall` into the feature table.

| Customer | Characteristics | Target demo outcome |
|---|---|---|
| **Alex** | Stable finances / sufficient liquid reserves | Financial Tier 0 |
| **Tom** | Casual worker, naturally variable wages, shrinking balance and limited buffer; repayment still covered | Financial Tier 1 |
| **Sarah** | Part-time, lower hours/income, current balance plus scheduled transactions produces a 28 Nov repayment gap | Financial Tier 2, **$620 shortfall on 28 Nov 2026** |
| **Mia** | Recent hardship and an *observed*, simulated failed loan repayment event | Financial Tier 3 |

To reproduce Sarah's **specific** 14-day demonstration, the following **illustrative, known/simulated future events** are acceptable as long as accounting history is consistent:

- Available balance as of **16 Nov 2026**: **$420**.
- Future planned income before repayment: **+$900** (must be marked confirmed vs estimated as appropriate).
- Required expenses before repayment: **−$940**.
- Scheduled home-loan repayment on **28 Nov 2026**: **−$1,000**.
- Post-repayment projected available balance: **$420 + $900 − $940 − $1,000 = −$620**; expected repayment funding gap **$620**.

The realised future may differ from the forecast because of uncertain income. Make that distinction explicit. Tests must verify the dates and arithmetic and confirm that modifying inputs recomputes the outcome.

For **Tom**, also create a control with the **same income volatility but high savings** that stays Tier 0. This shows we are **not penalising casual workers merely for irregular pay**.

Specialist-support demo: an explicit manual `customer_disclosed_specialist_need=True` flag triggers specialist routing and suppresses normal alerts; never infer this from transaction categories.

---

## 9. Streamlit interface — MVP screens

Build a usable, responsive dashboard with these sections/tabs:

### A. Customer insights (required)

- Select Alex / Tom / Sarah / Mia (and optionally a random synthetic customer).
- Explicit **demo consent checkbox** before showing account-specific analysis.
- Summary cards: financial tier, income trend, buffer days, recent net cash flow, projected loan shortfall and due date.
- Time-series balance chart and income chart; repayment due-date marker.
- Explainable **“Why am I seeing this?”** panel using calculated reason codes.
- Clearly label amounts **AUD**, simulation, as-of date, forecast assumptions and confidence / missing-data status.

### B. Cash-flow forecast (required)

- Daily projected balance (next 14 days), base and conservative scenarios.
- List of scheduled money movements and dated potential shortfall.
- For Sarah, spotlight “You may be **$620 short on 28 Nov**” (conditional language).
- For irregular income, show a **range** or scenario-dependent projection rather than a precise unqualified promise.

### C. Experimental ML (required if trained; graceful fallback otherwise)

- Synthetic estimated probability of a failed repayment **conditional on a repayment due in the next 14 days**.
- Metrics and training sample size; synthetic-data banner.
- Explain the difference between **ML prediction**, **cash-flow projection**, and **support tier**.

### D. Support journey (simple demo, no live submission)

- Suggested action appropriate to the current support tier.
- Customer choice: **Show me why / Talk to someone / Not now / This isn't right**.
- Mock “prepare support request” flow; show **customer verification** and a **human-review handover** step.
- No message sent or bank request lodged in the real world.
- If a customer discloses a sensitive situation, stop the automated flow and show a specialist handover option.

**Streamlit is temporary UI only.** Business logic must not live inside Streamlit scripts.

---

## 10. FastAPI integration for the team's demo website

Expose a **versioned JSON API**, backed by exactly the same domain services as Streamlit. Example routes (adjust names if consistent):

```text
GET  /health
GET  /api/v1/demo/customers
GET  /api/v1/demo/customers/{customer_id}
POST /api/v1/analysis                 # customer + explicit consent + as_of
GET  /api/v1/demo/model/metrics
```

**Production-like integration intention:** the React/Next.js frontend should render the output of `/api/v1/analysis`; it must **not reimplement risk logic or compute tier itself**. The endpoint serves synthetic/demo data only and must not be exposed as a real bank-data ingestion service.

### Suggested response shape

```json
{
  "customer_id": "SARAH",
  "as_of_date": "2026-11-16",
  "data_source": "synthetic",
  "consent_confirmed": true,
  "assessment_status": "complete",
  "financial_tier": 2,
  "tier_label": "At risk",
  "specialist_support_required": false,
  "reason_codes": ["EXPECTED_REPAYMENT_GAP", "LOW_BUFFER"],
  "features": {
    "income_change_pct": -0.25,
    "income_volatility": 0.18,
    "net_cash_flow_30d": -400.0,
    "cash_buffer_days": 4.0
  },
  "forecast": {
    "scenario": "base",
    "horizon_days": 14,
    "shortfall_amount_aud": 620.0,
    "shortfall_date": "2026-11-28",
    "assumptions": ["Illustrative scheduled income and bills"],
    "daily_balances": []
  },
  "ml_experiment": {
    "model_status": "not_trained",
    "predicted_probability": null,
    "description": "Synthetic research model only"
  },
  "recommended_action": "Offer a private, optional conversation about repayment assistance"
}
```

This JSON is a **schema illustration**, not actual precomputed feature values. Do not hard-code `-0.25`, `0.18`, `$620`, or the tier as server responses; obtain them from the simulator/analysis service. `daily_balances` should contain real daily forecast values in the implemented endpoint. Use Pydantic to validate complete response schemas.

**Consent behavior:** If no consent for analysis, respond with `consent_required` / an appropriate HTTP error and do not return private-style account analysis. Demo GET endpoints are fictional and must carry `data_source: synthetic`.

Provide an `examples/NextJsCareLoopPanel.tsx` calling the API (or a minimal JS `fetch` snippet) and a `.env.example` documenting `NEXT_PUBLIC_CARELOOP_API_URL`. Configure CORS for specified development origins rather than wildcard, and do not imply the demo API has production authentication.

---

## 11. Suggested repository structure

```text
careloop/
├── README.md
├── requirements.txt
├── .env.example
├── app.py                           # Streamlit frontend only
├── api.py                           # FastAPI frontend only
├── careloop/
│   ├── __init__.py
│   ├── config.py                    # dates, thresholds, seeds
│   ├── schemas.py                   # Pydantic contracts
│   ├── db.py                        # SQLite schema / persistence
│   ├── simulator.py                 # event-driven customer finances
│   ├── sample_customers.py          # deterministic four customers
│   ├── features.py                  # as-of feature calculations
│   ├── forecast.py                  # 14-day cash-flow scenarios
│   ├── tiers.py                     # explainable support routing
│   ├── ml.py                        # train/evaluate/save/predict
│   └── service.py                   # shared façade used by both UIs
├── scripts/
│   ├── generate_data.py
│   ├── build_features.py
│   ├── train_model.py
│   └── check_demo.py
├── examples/
│   └── NextJsCareLoopPanel.tsx
├── tests/
│   ├── test_simulator.py
│   ├── test_feature_engineering.py
│   ├── test_forecast.py
│   ├── test_tiers.py
│   ├── test_ml_no_leakage.py
│   └── test_api.py
├── data/                            # generated locally; no real data
│   └── .gitkeep
└── models/                          # generated locally
    └── .gitkeep
```

Use existing conventions where practical; **don't over-engineer**. A smaller working set of modules is preferable to incomplete scaffolding.

---

## 12. Acceptance tests — do not mark complete unless these pass

### Accounting & simulation

- `opening_balance + sum(posted amounts) == closing_balance` per account, within decimal tolerance.
- Failed loan repayment **does not** subtract money that was never paid.
- Internal transfer between own accounts does not count as new income.
- Changing a customer's raw transactions causes features and forecast to **recompute**, not remain hard-coded.
- Re-running the simulator with the same seed gives the same synthetic dataset.

### Time and labels

- A feature snapshot at `t` is **unchanged** if a transaction only after `t` is modified.
- Future realised income shocks are never read during current prediction.
- Target is 1 only for an **observed simulated failed repayment** in `(t, t+14]`.
- Snapshots with **no repayment due** are excluded from the first binary learning experiment.
- No customer appears in both train and test groups.

### Fairness / common-sense controls

- A well-funded casual worker with variable wages remains **Tier 0**.
- A regular salaried worker with a credible near-term loan shortfall becomes **Tier 2**, irrespective of stable employment.
- A customer with only high income volatility does **not** automatically get a warning tier.
- Missing salary information becomes **unknown/insufficient**, never automatically “zero income / job loss”.

### Specific demo outcomes

- Alex → financial Tier 0.
- Tom → financial Tier 1, **no near-term repayment gap**.
- Sarah → financial Tier 2, **$620 base-case gap on 2026-11-28**, assuming the configured scheduled events.
- Mia → financial Tier 3 based on a **past observed failed repayment**.
- Explicit specialist disclosure → specialist routing; automatic heads-up suppressed; **never** inferred from spending.

### App/API

- Streamlit can display all four customer demos and shows the consent gate.
- `/health` and API tests pass with FastAPI TestClient.
- API response tier, reasons and shortfall match the **same domain service** used by Streamlit.
- A client without analysis consent cannot obtain personalised analysis through the `POST` endpoint.
- ML screen behaves sensibly if the model file does not yet exist.
- Synthetic-data disclaimer is clearly visible in both app and README.

---

## 13. One-day implementation order

Build the **smallest vertical slice** before expanding scope:

1. **Core demo data:** Build Alex, Tom, Sarah and Mia as raw transaction/event histories with correct dates and balances.
2. **Feature and forecast engine:** Implement the first 8 features and 14-day base forecast; test Sarah's $620 arithmetic and the casual-worker controls.
3. **Rules engine:** Return tiers 0–3, specialist routing, reasons, confidence/data quality.
4. **Streamlit MVP:** Customer selector, consent, charts, financial features, forecast, appropriate support action.
5. **API integration:** FastAPI and a minimal React/Next.js fetch example; test response parity.
6. **Synthetic cohort & ML experiment:** Scale simulator to 1,000 customers, generate time-safe labelled snapshots, train Logistic Regression, evaluate and display experimental output.
7. **Polish and tests:** Run test suite and rehearse Sarah's journey. Make ML gracefully optional if time runs short.

**Do not sacrifice the working Sarah + API demo to chase impressive ML metrics.**

---

## 14. Execution guide Claude should deliver

Write a README with exact **Windows PowerShell / VS Code** commands; at minimum target:

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python scripts/generate_data.py --customers 1000 --seed 42
python scripts/build_features.py
python scripts/train_model.py
python -m pytest -q
python -m streamlit run app.py
```

For the API in another terminal:

```powershell
python -m uvicorn api:app --reload --port 8000
```

The implemented CLI may be simpler, but the documentation **must match actual files and supported arguments**. Add a friendly `scripts/check_demo.py` command which prints each customer's tier, principal warning signals and Sarah's shortfall so the team can validate without a browser.

The API docs should be available at `http://localhost:8000/docs`. Add a one-paragraph explanation of how to use the same API from the team's separate site and how to deploy only a **synthetic demo**.

---

## 15. Output expected from Claude

Please create the files and runnable application. At the end, report:

- **Files created/changed** and how to run them;
- **What is implemented** versus deliberately deferred;
- **Example analysis** for Alex, Tom, Sarah and Mia, showing values **computed from the generated event histories**;
- **Model training results** measured on held-out synthetic customer groups, including counts, prevalence and caveats (do not make up metrics; if training wasn't run, say so);
- **Tests actually executed** with pass/fail summaries;
- **Website integration instructions** with endpoint and request/response shape;
- **Known limitations**: synthetic domain only, unverified thresholds, incomplete account observability, different income patterns and prediction uncertainty.

**Final presentation wording:**

> CareLoop demonstrates how consent-based analysis of transaction patterns, short-term cash-flow scenarios and an experimental synthetic-data ML model can help identify potential repayment pressure. The pilot uses fictional customers; the model and thresholds would require real-world validation, fairness review, privacy assessment and human governance before any bank deployment.

---

## 16. Source alignment and design decisions

**From the supplied 9-page `CareLoop Explained Simply` proposal (11 November 2026):** Westpac app context; Sarah's **$620 / 28 Nov** demo; Tom and Mia; Tier 0–4 names; consent and discreet opt-in alerts; specialist routing; staff-only hardship decisions; preference for rules initially; the core “notice early → make asking easy → follow through” journey.

**New implementation decisions proposed in this specification:** 1,000-customer/180-day event-driven simulator, systematic features, irregular-income safeguards, two-scenario forecast, a future-outcome-labelled synthetic ML experiment, explicit train/test grouping, SQLite schema, FastAPI contract, and automated acceptance tests. These are **engineering proposals**, not capabilities claimed to exist in Westpac's live systems.

**Explicitly not claimed:** Synthetic data is not proof of true Australian financial-hardship prediction, and the prototype does not provide bank consent/authentication, account access, credit decisions or real support applications.
