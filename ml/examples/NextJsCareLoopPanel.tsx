"use client";
// CareLoop demo panel for the team's Next.js site (App Router client component).
// Renders the API's analysis - it must NOT compute tiers or shortfalls itself.
// Set NEXT_PUBLIC_CARELOOP_API_URL=http://localhost:8000 in .env.local
// Fictional synthetic customers only. The demo API has no production authentication.
import { useState } from "react";

type DailyBalance = { date: string; balance: number };
type Reason = { code: string; text: string };
type Analysis = {
  customer_id: string;
  display_name: string;
  as_of_date: string;
  data_source: string;
  assessment_status: "complete" | "insufficient_data";
  financial_tier: number | null;
  tier_label: string;
  specialist_support_required: boolean;
  reasons: Reason[];
  forecast: {
    shortfall_amount_aud: number;
    shortfall_date: string | null;
    confidence: string;
    daily_balances: DailyBalance[];
    conservative: { shortfall_amount_aud: number };
  };
  ml_experiment: { model_status: string; predicted_probability: number | null; disclaimer: string };
  recommended_action: string;
  disclaimer: string;
};

const API = process.env.NEXT_PUBLIC_CARELOOP_API_URL ?? "http://localhost:8000";
const CUSTOMERS = ["SARAH", "TOM", "MIA", "ALEX"];

export default function NextJsCareLoopPanel() {
  const [customer, setCustomer] = useState("SARAH");
  const [consent, setConsent] = useState(false);
  const [data, setData] = useState<Analysis | null>(null);
  const [error, setError] = useState("");

  async function analyse() {
    setError("");
    setData(null);
    const res = await fetch(`${API}/api/v1/analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer_id: customer, consent_confirmed: consent, as_of_date: "2026-11-16" }),
    });
    if (res.status === 403) return setError("Please confirm consent before we analyse this demo account.");
    if (!res.ok) return setError(`API error ${res.status}`);
    setData((await res.json()) as Analysis);
  }

  return (
    <section aria-label="CareLoop synthetic demo">
      <h2>CareLoop · fictional account demo</h2>
      <label>
        Customer{" "}
        <select value={customer} onChange={(e) => setCustomer(e.target.value)}>
          {CUSTOMERS.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label style={{ marginLeft: 12 }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I consent to
        analysing this fictional account
      </label>
      <button onClick={analyse} style={{ marginLeft: 12 }}>Analyse</button>
      {error && <p role="alert">{error}</p>}
      {data && (
        <div>
          <p><strong>{data.financial_tier === null ? data.tier_label : `Tier ${data.financial_tier}: ${data.tier_label}`}</strong>
            {data.specialist_support_required && " · specialist support offered"}</p>
          {data.forecast.shortfall_amount_aud > 0 && (
            <p>You may be about AUD {data.forecast.shortfall_amount_aud.toFixed(0)} short on {data.forecast.shortfall_date}
              {" "}(stress case up to AUD {data.forecast.conservative.shortfall_amount_aud.toFixed(0)}; confidence {data.forecast.confidence}).</p>
          )}
          <ul>{data.reasons.map((r) => <li key={r.code}>{r.text}</li>)}</ul>
          <p>{data.recommended_action}</p>
          <p>Experimental ML: {data.ml_experiment.predicted_probability === null
            ? data.ml_experiment.model_status
            : `${(data.ml_experiment.predicted_probability * 100).toFixed(0)}% (synthetic score)`}</p>
          <small>{data.disclaimer} {data.ml_experiment.disclaimer}</small>
        </div>
      )}
    </section>
  );
}
