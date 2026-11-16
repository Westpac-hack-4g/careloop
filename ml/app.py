"""CareLoop Streamlit demo - presentation only. All logic lives in careloop.service.

Run:  python -m streamlit run app.py
"""
from __future__ import annotations

from datetime import date, timedelta

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from careloop import config as C, service

st.set_page_config(page_title="CareLoop · synthetic demo", page_icon="💚", layout="wide")

TIER_COLOURS = {0: "#2e7d32", 1: "#f9a825", 2: "#ef6c00", 3: "#c62828", None: "#607d8b"}


def money(x) -> str:
    return "—" if x is None else f"AUD {x:,.0f}"


def vline(fig: go.Figure, x: str, text: str, colour: str = "#c62828") -> None:
    fig.add_shape(type="line", x0=x, x1=x, y0=0, y1=1, yref="paper", line=dict(color=colour, dash="dot"))
    fig.add_annotation(x=x, y=1, yref="paper", text=text, showarrow=False, yanchor="bottom",
                       font=dict(color=colour, size=11))


# ------------------------------------------------------------------ sidebar
st.sidebar.title("CareLoop")
st.sidebar.caption("Notice early → make asking easy → follow through")
demo = service.list_demo_customers()
labels = {c.customer_id: c.display_name for c in demo}
cohort = service.list_cohort_customers(limit=200)
options = [c.customer_id for c in demo] + (["__random__"] if cohort else [])
choice = st.sidebar.selectbox("Customer", options, index=2,
                              format_func=lambda k: "Random synthetic customer…" if k == "__random__" else labels[k])
if choice == "__random__":
    choice = st.sidebar.selectbox("Synthetic customer ID", [c.customer_id for c in cohort])
data = service.get_customer_data(choice)
st.sidebar.info(data.customer.get("story") or "")
as_of = st.sidebar.date_input("As-of date (simulation)", value=C.AS_OF_DATE,
                              min_value=date.fromisoformat(data.customer["history_start"]) + timedelta(days=28),
                              max_value=C.SIM_END - timedelta(days=C.LOOKAHEAD_DAYS))
consent = st.sidebar.checkbox("I consent to CareLoop analysing this fictional account for the demo",
                              key=f"consent_{choice}")
specialist = st.sidebar.checkbox("Customer has told us about a sensitive situation (specialist support)",
                                 key=f"specialist_{choice}",
                                 help="Set only by an explicit customer disclosure. Never inferred from spending.")
with st.sidebar.expander("Customer-confirmed upcoming income (optional)"):
    st.caption("Lets the customer correct our income estimate. Replaces estimated income in the forecast.")
    use_conf = st.checkbox("Use confirmed income", key=f"useconf_{choice}")
    conf_date = st.date_input("Pay date", value=as_of + timedelta(days=4), key=f"cd_{choice}")
    conf_amt = st.number_input("Amount (AUD)", min_value=0.0, value=900.0, step=50.0, key=f"ca_{choice}")
st.sidebar.divider()
st.sidebar.caption(C.DEMO_NOTICE)

# ------------------------------------------------------------------ header + consent gate
st.title(f"{data.customer['display_name']} · financial wellbeing check")
st.warning("**Synthetic demo** — fictional customer, simulated transactions, AUD. Not a Westpac product; "
           "no real account is accessed and nothing is sent anywhere.", icon="🧪")
if not consent:
    st.info("Tick the **consent** box in the sidebar to see the account analysis. "
            "Customers can still ask for help at any time without an automated alert.")
    st.stop()

confirmed = [{"date": conf_date.isoformat(), "amount": conf_amt}] if use_conf and conf_amt > 0 else None
r = service.analyse_data(data, as_of, consent=True, specialist_disclosed=specialist,
                         customer_confirmed_income=confirmed)
hist = service.history_for_charts(data, as_of)
f, fc, q = r.features, r.forecast, r.data_quality

if r.specialist_support_required:
    st.error(f"**{r.specialist_label}** — automated heads-ups are paused. Offer a private handover to the "
             "specialist team. This route came from the customer's own disclosure, not from transactions.", icon="🤝")

tab_a, tab_b, tab_c, tab_d = st.tabs(["A · Customer insights", "B · Cash-flow forecast",
                                      "C · Experimental ML", "D · Support journey"])

# ------------------------------------------------------------------ A. insights
with tab_a:
    st.caption(f"As of **{r.as_of_date}** · data quality **{q.data_quality}** · income visibility "
               f"**{q.income_visibility}** · forecast confidence **{fc.confidence}** · source: {r.data_source}")
    c1, c2, c3, c4, c5 = st.columns(5)
    tier_txt = f"Tier {r.financial_tier} · {r.tier_label}" if r.financial_tier is not None else r.tier_label
    c1.markdown(f"<div style='padding:.6rem;border-radius:.5rem;background:{TIER_COLOURS[r.financial_tier]};"
                f"color:white'><small>Support tier (rules)</small><br><b>{tier_txt}</b></div>",
                unsafe_allow_html=True)
    ic = f.get("income_change_pct")
    c2.metric("Income vs own usual", "unknown" if ic is None else f"{ic:+.0%}",
              help="Last 4 weeks vs the preceding 8–12 weeks of this customer's own income.")
    bd = f.get("cash_buffer_days")
    c3.metric("Cash buffer", "unknown" if bd is None else f"{bd:,.1f} days",
              help="Accessible funds ÷ average daily essential outgoings (last 30 days).")
    c4.metric("Net cash flow (30 d)", money(f.get("net_cash_flow_30d")))
    c5.metric("Projected repayment gap", money(fc.shortfall_amount_aud) if fc.shortfall_amount_aud else "none",
              delta=f"due {fc.shortfall_date}" if fc.shortfall_date else None, delta_color="off")
    if r.assessment_status == "insufficient_data":
        st.warning("We can't see enough income in this account to assess it. Ask the customer to confirm their "
                   "income (sidebar) instead of guessing a tier.")

    left, right = st.columns([3, 2])
    with left:
        hb = pd.DataFrame(hist["daily_balances"])
        fig = go.Figure()
        fig.add_trace(go.Scatter(x=hb["date"], y=hb["balance"], name="Accessible balance (actual)",
                                 line=dict(color="#1565c0")))
        start = [{"date": r.as_of_date, "balance": fc.start_balance_aud}]
        for scen, colour, dash in ((fc, "#ef6c00", "solid"), (fc.conservative, "#9e9e9e", "dash")):
            d = pd.DataFrame(start + [b.model_dump() for b in scen.daily_balances])
            fig.add_trace(go.Scatter(x=d["date"], y=d["balance"], name=f"Forecast – {scen.scenario}",
                                     line=dict(color=colour, dash=dash)))
        for ev in fc.events:
            if ev.event_type in ("loan_repayment", "card_repayment"):
                vline(fig, ev.date, f"repayment {ev.date[5:]}")
        fig.add_hline(y=0, line=dict(color="black", width=1))
        fig.update_layout(height=360, margin=dict(l=10, r=10, t=30, b=10), yaxis_title="AUD",
                          legend=dict(orientation="h", y=-0.15), title="Balance history and 14-day forecast")
        st.plotly_chart(fig, width="stretch")
    with right:
        wi = pd.DataFrame(hist["weekly_income"])
        fig2 = go.Figure(go.Bar(x=wi["week_ending"], y=wi["income"], marker_color="#2e7d32", name="Income"))
        if f.get("baseline_weekly_income"):
            fig2.add_hline(y=f["baseline_weekly_income"], line=dict(dash="dot"),
                           annotation_text="own usual weekly level")
        fig2.update_layout(height=360, margin=dict(l=10, r=10, t=30, b=10), yaxis_title="AUD",
                           title="Income received per week")
        st.plotly_chart(fig2, width="stretch")

    st.subheader("Why am I seeing this?")
    st.caption(f"Rule applied: {r.rule_applied}")
    if r.reasons:
        for reason in r.reasons:
            st.markdown(f"- **`{reason.code}`** — {reason.text}")
    else:
        st.success("No early-warning signals under the demo rules.")
    with st.expander("All calculated features (from raw transactions up to the as-of date)"):
        st.dataframe(pd.DataFrame([{"feature": k, "value": v, "missing_reason": r.missing_flags.get(k, "")}
                                   for k, v in f.items()]), hide_index=True, width="stretch")
        st.json({"income_streams": [s.model_dump() for s in r.income_streams], "data_quality": q.model_dump()})
    st.caption("Thresholds are demonstration settings. Income variability or employment type alone never "
               "raises a tier.")

# ------------------------------------------------------------------ B. forecast
with tab_b:
    if fc.shortfall_amount_aud > 0:
        st.error(f"### You may be about **AUD {fc.shortfall_amount_aud:,.0f} short** on **{fc.shortfall_date}**\n"
                 f"for your AUD {fc.planned_repayment_aud:,.0f} repayment — if income and bills arrive as expected.")
    elif fc.conservative.shortfall_amount_aud > 0:
        st.warning(f"Repayments look covered in the base case, but if income comes in lower than usual there "
                   f"could be a gap of up to AUD {fc.conservative.shortfall_amount_aud:,.0f} "
                   f"({fc.conservative.shortfall_date}). This is uncertain.")
    else:
        st.success("Known repayments in the next 14 days look covered in both scenarios.")
    st.caption(f"Range across scenarios: AUD {fc.shortfall_range_aud[0]:,.0f} – {fc.shortfall_range_aud[1]:,.0f} · "
               f"confidence **{fc.confidence}** ({'; '.join(fc.confidence_reasons)})")
    figf = go.Figure()
    for scen, colour, dash in ((fc, "#ef6c00", "solid"), (fc.conservative, "#757575", "dash")):
        d = pd.DataFrame([{"date": r.as_of_date, "balance": fc.start_balance_aud}] +
                         [b.model_dump() for b in scen.daily_balances])
        figf.add_trace(go.Scatter(x=d["date"], y=d["balance"], mode="lines+markers", name=scen.scenario,
                                  line=dict(color=colour, dash=dash, shape="hv")))
    if fc.shortfall_date:
        vline(figf, fc.shortfall_date, "projected gap")
    figf.add_hline(y=0, line=dict(color="black", width=1))
    figf.update_layout(height=340, yaxis_title="AUD", margin=dict(l=10, r=10, t=10, b=10))
    st.plotly_chart(figf, width="stretch")
    cb, cc = st.columns(2)
    for col, scen in ((cb, fc), (cc, fc.conservative)):
        with col:
            st.markdown(f"**{scen.scenario.title()} scenario — scheduled money movements**")
            st.dataframe(pd.DataFrame([e.model_dump() for e in scen.events]), hide_index=True,
                         width="stretch")
            for a in scen.assumptions:
                st.caption("• " + a)

# ------------------------------------------------------------------ C. ML
with tab_c:
    st.warning("**Experimental synthetic model.** " + C.SYNTHETIC_DISCLAIMER, icon="⚠️")
    ml = r.ml_experiment
    m = service.model_metrics()
    if ml.model_status == "not_trained":
        st.info("Experimental ML model not available. Run `python scripts/train_model.py`.")
    elif ml.model_status == "not_applicable":
        st.info(ml.message)
    elif ml.model_status == "available":
        a1, a2 = st.columns([1, 2])
        a1.metric("Synthetic score: repayment failure in next 14 days", f"{ml.predicted_probability:.0%}",
                  help="Conditional on a repayment being due. Ranking score from a class-weighted model; "
                       "not a calibrated probability.")
        a1.caption(f"Model threshold {ml.threshold:.2f} · {'above' if ml.above_threshold else 'below'} threshold")
        a2.markdown("**Largest contributions for this customer** (explain the simulator, not real credit drivers)")
        a2.dataframe(pd.DataFrame([c.model_dump() for c in ml.top_contributions]), hide_index=True)
    else:
        st.info(ml.message)
    if m.get("model_status") == "available":
        t = m["models"]["logistic_regression"]["test"]
        b1, b2, b3, b4, b5 = st.columns(5)
        b1.metric("Held-out ROC-AUC", t["roc_auc"])
        b2.metric("PR-AUC", t["average_precision"])
        b3.metric("Brier", t["brier"])
        b4.metric("Test customers", m["n_test_customers"])
        b5.metric("Prevalence", f"{m['prevalence']:.1%}")
        st.caption(f"{m['n_customers']} synthetic customers · {m['n_snapshots']} labelled snapshots · "
                   f"{m['positives']} positives · split by customer · baseline PR-AUC "
                   f"{m['models']['baseline_prevalence']['test']['average_precision']}")
        with st.expander("Coefficients, other models and per-profile results (simulation only)"):
            st.dataframe(pd.DataFrame(m["lr_coefficients"]), hide_index=True)
            st.json({"models": m["models"], "per_profile_test_lr": m["per_profile_test_lr"]})
    st.markdown("""
| | What it is | Decides the tier? |
|---|---|---|
| **Support tier** | Transparent rules over calculated features and the forecast | **Yes** (with human review) |
| **Cash-flow projection** | Day-by-day arithmetic over known bills and estimated income | Feeds the rules |
| **ML prediction** | Pattern score learned from *synthetic* histories | **No** — shown for exploration only |
""")

# ------------------------------------------------------------------ D. support journey
with tab_d:
    sj = r.support_journey
    st.markdown(f"**Suggested next step:** {sj.recommended_action}")
    st.caption("No message is sent and no request is lodged — this is a mock flow. Staff, not software, "
               "decide any hardship arrangement.")
    if r.specialist_support_required:
        st.error("Automated flow stopped. Offer: *“Would you like to speak privately with our specialist team?”*")
        st.button("Connect me to the specialist team (demo)", key="spec_btn")
        st.stop()
    pick = st.radio("What would you like to do?", sj.customer_choices, horizontal=True, index=2,
                    key=f"pick_{choice}")
    if pick == "Show me why":
        for reason in r.reasons:
            st.markdown(f"- {reason.text}")
        st.caption("Estimates use only this account's past transactions and known upcoming bills. They may be "
                   "wrong if income arrives elsewhere or plans change.")
    elif pick == "Not now":
        st.info("No problem — we won't remind you about this. You can come back any time.")
    elif pick == "This isn't right":
        st.text_area("Tell us what's wrong (e.g. income paid into another bank, a bill already paid)",
                     key=f"fb_{choice}")
        st.info("Your correction would be reviewed by a person; you can also confirm upcoming income in the sidebar.")
    else:
        st.markdown("#### Prepare a support request (draft — not submitted)")
        s1, s2, s3 = st.columns(3)
        s1.markdown("**1. Draft**\n\nCareLoop pre-fills facts it calculated.")
        s2.markdown("**2. You check it**\n\nEdit or remove anything.")
        s3.markdown("**3. Human review**\n\nA staff member contacts you.")
        draft = (f"Customer: {r.display_name}\nAs of: {r.as_of_date}\n"
                 f"Upcoming repayment: AUD {fc.planned_repayment_aud or 0:,.2f} on {fc.planned_repayment_date or 'n/a'}\n"
                 f"Possible shortfall (base case): AUD {fc.shortfall_amount_aud:,.2f}\n"
                 f"Reasons: {', '.join(x.code for x in r.reasons) or 'customer request'}\n"
                 "I would like to talk about repayment support options.")
        st.text_area("Draft summary (editable)", draft, height=160, key=f"draft_{choice}")
        verified = st.checkbox("I have checked these details and want a person to contact me", key=f"ver_{choice}")
        if st.button("Hand over to human review (demo)", disabled=not verified, key=f"hand_{choice}"):
            st.success("Demo: request marked 'awaiting staff review'. Nothing was sent. "
                       f"Response-time setting shown to staff: {sj.response_time_policy_days} days "
                       f"({sj.response_time_note})")
