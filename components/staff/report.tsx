"use client";

import { useState } from "react";
import { money, shortDate } from "@/lib/client/api";
import type { BranchReport, NightlyReport } from "@/lib/contract";

// The nightly branch report. Counts only: no customer is named here.
// Named follow-up happens in the queue, through CareLoop and the Assist team.

const TIER_TONE = ["text-text-muted", "text-text-heading", "text-text-primary", "text-text-danger"];

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-1.5 text-[11px] font-bold uppercase text-text-muted">{children}</div>
);

const Stat = ({ value, label, tone = "text-text-heading" }: { value: string | number; label: string; tone?: string }) => (
  <div className="rounded-lg border border-border-muted-soft px-3 py-2">
    <div className={`text-[20px] font-bold leading-tight tabular-nums ${tone}`}>{value}</div>
    <div className="text-[11px] leading-snug text-text-muted">{label}</div>
  </div>
);

function Branch({ branch, forecastDays }: { branch: BranchReport; forecastDays: number }) {
  const { shortfalls, careloop } = branch;
  const tallest = Math.max(...shortfalls.days.map((d) => d.amount), 1);
  const mostCommon = Math.max(...branch.signals.map((s) => s.count), 1);
  return (
    <>
      <div className="rounded-lg bg-background-faint p-3">
        <Label>{branch.summary.by === "ai" ? "Summary · written by AI from the counts below" : "Summary · written by rules"}</Label>
        <p className="text-[13px] leading-snug text-text-heading">{branch.summary.text}</p>
      </div>

      <div className="mt-3">
        <Label>Customers by tier · {branch.customers.toLocaleString("en-AU")} at this branch</Label>
        <div className="grid grid-cols-4 gap-2">
          {branch.tiers.map((t) => (
            <Stat key={t.tier} value={t.count} label={`Tier ${t.tier} · ${t.name}`} tone={TIER_TONE[t.tier]} />
          ))}
        </div>
        {branch.notAssessed > 0 && <p className="mt-1 text-[11px] text-text-muted">{branch.notAssessed} more have too little history to place.</p>}
      </div>

      <div className="mt-3 grid grid-cols-[3fr_2fr] gap-4">
        <div>
          <Label>When repayments may fall short · next {forecastDays} days{shortfalls.days.length > 6 ? `, from ${shortDate(shortfalls.days[0].date)}` : ""}</Label>
          {shortfalls.days.length ? (
            <>
              <div className="flex h-[72px] items-end gap-1.5 border-b border-border-muted-soft">
                {shortfalls.days.map((d) => (
                  <div key={d.date} className="flex flex-1 flex-col items-center justify-end" title={`${shortDate(d.date)}: ${d.customers} repayments, ${money(d.amount)}`}>
                    <span className="text-[10px] tabular-nums text-text-muted">{d.customers}</span>
                    <span className="w-full rounded-t-sm bg-surface-primary" style={{ height: `${Math.max(4, (d.amount / tallest) * 48)}px` }} />
                  </div>
                ))}
              </div>
              <div className="flex gap-1.5">
                {shortfalls.days.map((d) => (
                  <span key={d.date} className="flex-1 text-center text-[10px] text-text-muted">{shortfalls.days.length > 6 ? shortDate(d.date).split(" ")[0] : shortDate(d.date)}</span>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-text-muted">
                {shortfalls.customers} repayments, {money(shortfalls.total)} in total. The number on each bar is how many repayments; its height is the amount.
              </p>
            </>
          ) : (
            <p className="text-[12px] text-text-muted">No repayment is forecast to fall short.</p>
          )}
        </div>
        <div>
          <Label>Most common signals · tier 1 to 3</Label>
          <ul className="space-y-1">
            {branch.signals.map((s) => (
              <li key={s.code} className="grid grid-cols-[minmax(0,1fr)_70px_28px] items-center gap-2 text-[12px]">
                <span className="truncate">{s.label}</span>
                <span className="h-1.5 rounded-full bg-surface-muted-pale">
                  <span className="block h-1.5 rounded-full bg-surface-hero" style={{ width: `${(s.count / mostCommon) * 100}%` }} />
                </span>
                <span className="text-right tabular-nums text-text-muted">{s.count}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-text-muted">
            The ML second opinion also ranks {branch.mlAgrees} of the tier 2 and 3 customers High.
          </p>
        </div>
      </div>

      <div className="mt-3">
        <Label>CareLoop at this branch so far</Label>
        <div className="grid grid-cols-4 gap-2">
          <Stat value={careloop.headsUps} label="Heads-ups sent" />
          <Stat value={careloop.requests} label="Requests with the Assist team" />
          <Stat value={careloop.waiting} label={careloop.nextDeadline ? `Waiting for a person · next reply due ${shortDate(careloop.nextDeadline)}` : "Waiting for a person"} tone={careloop.waiting ? "text-text-primary" : undefined} />
          <Stat value={careloop.arrangements} label="Arrangements in place" tone={careloop.arrangements ? "text-text-success" : undefined} />
        </div>
        <p className="mt-1 text-[11px] text-text-muted">
          {careloop.notContacted} tier 2 and 3 customers have had no heads-up yet. The queue shows who they are.
        </p>
      </div>
    </>
  );
}

export function ReportView({ report }: { report: NightlyReport | null }) {
  const [picked, setPicked] = useState<string | null>(null);
  if (!report) {
    return (
      <section className="m-4 flex-1 rounded-lg border border-dashed border-border-muted-mild p-6 text-[13px] text-text-muted">
        <div className="text-[14px] font-bold text-text-heading">No report yet</div>
        <p className="mt-1">
          The report builds itself each night, after the risk run has looked at every customer. No one asks for it, and no single customer&apos;s action starts it.
        </p>
      </section>
    );
  }
  const branch = report.branches.find((b) => b.branch === picked) ?? report.branches[0];
  return (
    <section className="m-4 flex-1 overflow-y-auto rounded-lg border border-border-muted-soft p-4 text-[13px]">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-[14px] font-bold text-text-heading">Nightly report · {branch.branch} branch</div>
          <div className="text-[11px] text-text-muted">
            Built by itself after the risk run on {shortDate(report.asOf, true)} · {report.totalCustomers.toLocaleString("en-AU")} customers checked{report.branches.length > 1 ? ` across ${report.branches.length} branches` : ""} · counts only, no names
          </div>
        </div>
        {/* Each branch gets its own report. The demo data has one branch, so the switch stays hidden. */}
        {report.branches.length > 1 && <div className="flex overflow-hidden rounded-md border border-border-muted-soft text-[12px]" role="tablist" aria-label="Branch">
          {report.branches.map((b) => (
            <button
              key={b.branch}
              role="tab"
              aria-selected={b.branch === branch.branch}
              onClick={() => setPicked(b.branch)}
              className={`cursor-pointer border-r border-border-muted-soft px-2.5 py-1 last:border-r-0 ${b.branch === branch.branch ? "bg-surface-hero font-bold text-text-mono" : "bg-background-white text-text-hero hover:bg-surface-hero-faint"}`}
            >
              {b.branch}
            </button>
          ))}
        </div>}
      </div>
      <Branch branch={branch} forecastDays={report.forecastDays} />
      <p className="mt-3 border-t border-border-muted-soft pt-2 text-[11px] text-text-muted">
        Synthetic customers and a made-up branch. Rules count every figure; the AI only writes the summary, and a summary with a figure the rules did not produce is thrown away.
      </p>
    </section>
  );
}
