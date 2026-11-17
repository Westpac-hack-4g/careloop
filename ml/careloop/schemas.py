"""Pydantic JSON contracts shared by FastAPI, Streamlit and the future website."""
from __future__ import annotations

from datetime import date
from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

Num = Optional[Union[int, float, bool]]


class ConfirmedIncome(BaseModel):
    date: date
    amount: float = Field(gt=0, le=50_000)
    description: str = "Income confirmed by customer"


class AnalysisRequest(BaseModel):
    model_config = ConfigDict(json_schema_extra={"example": {
        "customer_id": "SARAH", "consent_confirmed": True, "as_of_date": "2026-11-16",
        "customer_disclosed_specialist_need": False}})
    customer_id: str = Field(min_length=1, max_length=40)
    consent_confirmed: bool = False
    as_of_date: Optional[date] = None
    customer_disclosed_specialist_need: bool = False
    customer_confirmed_income: Optional[list[ConfirmedIncome]] = Field(default=None, max_length=10)


class Reason(BaseModel):
    code: str
    text: str


class DailyBalance(BaseModel):
    date: str
    balance: float


class ForecastEvent(BaseModel):
    date: str
    description: str
    category: str
    event_type: str
    amount_aud: float
    basis: str
    balance_after_aud: float


class ForecastScenario(BaseModel):
    scenario: Literal["base", "conservative"]
    horizon_days: int
    as_of_date: str
    start_balance_aud: float
    shortfall_amount_aud: float
    shortfall_date: Optional[str]
    planned_repayment_aud: Optional[float]
    planned_repayment_date: Optional[str]
    lowest_balance_aud: float
    lowest_balance_date: str
    assumptions: list[str]
    daily_balances: list[DailyBalance]
    events: list[ForecastEvent]


class Forecast(ForecastScenario):
    """Base scenario at the top level (website-friendly) + conservative scenario."""
    conservative: ForecastScenario
    confidence: Literal["high", "medium", "low"]
    confidence_reasons: list[str]
    shortfall_range_aud: list[float]


class DataQuality(BaseModel):
    history_days: int
    income_credits_observed: int
    usable_baseline_weeks: int
    income_visibility: Literal["adequate", "partial", "unknown", "customer_confirmed"]
    data_quality: Literal["sufficient", "partial", "insufficient"]
    external_own_account_inflows: bool


class IncomeStreamSummary(BaseModel):
    income_source_id: str
    cadence_days: int
    regular: bool
    last_observed_at: str
    base_amount: float
    conservative_amount: float
    amount_cv: Optional[float]
    status: str


class Contribution(BaseModel):
    feature: str
    contribution: float


class MLExperiment(BaseModel):
    model_status: Literal["available", "not_trained", "not_applicable", "incompatible"]
    predicted_probability: Optional[float]
    description: str
    disclaimer: str
    message: Optional[str] = None
    model_version: Optional[str] = None
    threshold: Optional[float] = None
    above_threshold: Optional[bool] = None
    top_contributions: list[Contribution] = []


class SupportJourney(BaseModel):
    recommended_action: str
    customer_choices: list[str]
    alerts_paused: bool
    specialist_handover_available: bool
    human_review_required: bool = True
    automated_decision: Literal[False] = False
    response_time_policy_days: int
    response_time_note: str


class AnalysisResponse(BaseModel):
    customer_id: str
    display_name: str
    as_of_date: str
    data_source: str
    consent_confirmed: bool
    assessment_status: Literal["complete", "insufficient_data"]
    financial_tier: Optional[int] = Field(default=None, ge=0, le=3)
    tier_label: str
    specialist_support_required: bool
    specialist_label: Optional[str] = None
    alerts_paused: bool
    rule_applied: Optional[str]
    reason_codes: list[str]
    reasons: list[Reason]
    warning_signals: list[str]
    features: dict[str, Num]
    missing_flags: dict[str, str]
    data_quality: DataQuality
    income_streams: list[IncomeStreamSummary]
    forecast: Forecast
    ml_experiment: MLExperiment
    recommended_action: str
    support_journey: SupportJourney
    feature_version: str
    disclaimer: str


class CustomerSummary(BaseModel):
    customer_id: str
    display_name: str
    profile_type: str
    data_source: str
    story: Optional[str] = None


class TransactionOut(BaseModel):
    transaction_id: str
    account_id: str
    posted_at: str
    amount: float
    category: str
    direction: Literal["credit", "debit"]
    status: Literal["posted", "failed"]
    counterparty_type: Optional[str]
    income_source_id: Optional[str]
    description: Optional[str] = None


class CustomerDetail(CustomerSummary):
    as_of_date: str
    accounts: list[dict]
    recent_transactions: list[TransactionOut]
    known_upcoming_events: list[dict]
    note: str = "Fictional demo data. Personalised analysis requires POST /api/v1/analysis with consent."


class ConsentRequired(BaseModel):
    status: Literal["consent_required"] = "consent_required"
    message: str = "Explicit consent is required before account analysis is returned."
