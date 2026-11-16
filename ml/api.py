"""CareLoop FastAPI - thin JSON layer over careloop.service (synthetic demo data only).

Run:  python -m uvicorn api:app --reload --port 8000     ->  http://localhost:8000/docs

This is NOT a bank-data ingestion service and has NO production authentication.
"""
from __future__ import annotations

import os
from datetime import date
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from careloop import __version__, config as C, service
from careloop.schemas import AnalysisRequest, AnalysisResponse, ConsentRequired, CustomerDetail, CustomerSummary

app = FastAPI(
    title="CareLoop Synthetic Demo API", version=__version__,
    description=("Explainable repayment-pressure demo on **fictional, synthetic** customers. "
                 "Not a bank service, no real data, no automated hardship decisions. " + C.SYNTHETIC_DISCLAIMER))

ALLOWED_ORIGINS = [o.strip() for o in os.environ.get(
    "CARELOOP_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173").split(",")
    if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_credentials=False,
                   allow_methods=["GET", "POST"], allow_headers=["Content-Type"])


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": __version__, "data_source": "synthetic",
            "model_available": service.model_metrics()["model_status"] == "available"}


@app.get("/api/v1/demo/customers")
def demo_customers(include_cohort: bool = Query(False, description="Also list generated synthetic customers"),
                   limit: int = Query(25, ge=1, le=200)) -> dict:
    items: list[CustomerSummary] = service.list_demo_customers()
    if include_cohort:
        items += service.list_cohort_customers(limit)
    return {"data_source": "synthetic", "customers": [c.model_dump() for c in items]}


@app.get("/api/v1/demo/customers/{customer_id}", response_model=CustomerDetail)
def demo_customer(customer_id: str, as_of_date: Optional[date] = None) -> CustomerDetail:
    try:
        return service.customer_detail(customer_id, as_of_date)
    except service.UnknownCustomerError:
        raise HTTPException(404, "Unknown fictional customer")
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@app.post("/api/v1/analysis", response_model=AnalysisResponse,
          responses={403: {"model": ConsentRequired, "description": "Consent not confirmed"}})
def analysis(request: AnalysisRequest) -> AnalysisResponse:
    """Full analysis. Requires `consent_confirmed: true`; the website must render this, not recompute it."""
    try:
        return service.analyse(request)
    except service.ConsentRequiredError:
        raise HTTPException(403, ConsentRequired().model_dump())
    except service.UnknownCustomerError:
        raise HTTPException(404, "Unknown fictional customer")
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@app.get("/api/v1/demo/model/metrics")
def model_metrics() -> dict:
    return service.model_metrics()
