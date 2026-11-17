"""FastAPI contract tests (TestClient)."""
from fastapi.testclient import TestClient

from api import app
from careloop.sample_customers import demo_customer
from careloop.service import analyse_data

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok" and r.json()["data_source"] == "synthetic"


def test_demo_customer_list_and_detail():
    r = client.get("/api/v1/demo/customers")
    ids = [c["customer_id"] for c in r.json()["customers"]]
    assert {"ALEX", "TOM", "SARAH", "MIA"} <= set(ids)
    d = client.get("/api/v1/demo/customers/SARAH").json()
    assert d["data_source"] == "synthetic_demo" and d["recent_transactions"]
    assert "financial_tier" not in d                   # analysis needs consent via POST
    assert client.get("/api/v1/demo/customers/NOBODY").status_code == 404


def test_analysis_requires_consent():
    r = client.post("/api/v1/analysis", json={"customer_id": "SARAH"})
    assert r.status_code == 403
    assert r.json()["detail"]["status"] == "consent_required"
    assert "financial_tier" not in r.text


def test_analysis_matches_shared_service():
    r = client.post("/api/v1/analysis", json={"customer_id": "SARAH", "consent_confirmed": True,
                                              "as_of_date": "2026-11-16"})
    assert r.status_code == 200
    body = r.json()
    direct = analyse_data(demo_customer("SARAH"))
    assert body["financial_tier"] == direct.financial_tier == 2
    assert body["reason_codes"] == direct.reason_codes
    assert body["forecast"]["shortfall_amount_aud"] == direct.forecast.shortfall_amount_aud == 620.0
    assert body["forecast"]["shortfall_date"] == "2026-11-28"
    assert len(body["forecast"]["daily_balances"]) == 14
    assert body["data_source"] == "synthetic_demo"
    assert body["ml_experiment"]["model_status"] in {"available", "not_trained", "not_applicable"}


def test_specialist_and_confirmed_income_via_api():
    r = client.post("/api/v1/analysis", json={"customer_id": "SARAH", "consent_confirmed": True,
                                              "customer_disclosed_specialist_need": True}).json()
    assert r["specialist_support_required"] and r["alerts_paused"]
    r = client.post("/api/v1/analysis", json={"customer_id": "SARAH", "consent_confirmed": True,
                                              "customer_confirmed_income": [{"date": "2026-11-20", "amount": 1700}]}).json()
    assert r["forecast"]["shortfall_amount_aud"] == 0 and r["financial_tier"] != 2


def test_bad_inputs():
    assert client.post("/api/v1/analysis", json={"customer_id": "SARAH", "consent_confirmed": True,
                                                 "as_of_date": "2020-01-01"}).status_code == 422
    assert client.post("/api/v1/analysis", json={"customer_id": "NOBODY", "consent_confirmed": True}).status_code == 404


def test_model_metrics_endpoint():
    r = client.get("/api/v1/demo/model/metrics").json()
    assert r["model_status"] in {"available", "not_trained"} and r["data_source"] == "synthetic"


def test_cors_is_not_wildcard():
    r = client.options("/api/v1/analysis", headers={"Origin": "https://evil.example",
                                                    "Access-Control-Request-Method": "POST"})
    assert r.headers.get("access-control-allow-origin") != "*"
