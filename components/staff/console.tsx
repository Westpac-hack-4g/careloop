"use client";

import { Badge } from "@westpac/ui/badge";
import { Button } from "@westpac/ui/button";
import { Input } from "@westpac/ui/input";
import { Select } from "@westpac/ui/select";
import { WBCLogo } from "@westpac/ui/symbol";
import { useState } from "react";
import type { CaseStatus, CustomerId, NightlyReport, QueueRow, TimelineItem } from "@/lib/contract";
import { DECISIONS, type DecisionKey } from "@/lib/decisions";
import { shortDate } from "@/lib/client/api";
import { ReportView } from "./report";

const STATUS: Record<CaseStatus, string> = {
  new: "New",
  in_review: "In review",
  arrangement: "Arrangement in place",
  closed: "Closed",
  watching: "Watching",
  priority_assist: "Priority Assist",
};

// GEL badge colour for each status (presentation only).
const STATUS_COLOR: Record<CaseStatus, "primary" | "hero" | "success" | "faint" | "info" | "danger"> = {
  new: "primary",
  in_review: "info",
  arrangement: "success",
  closed: "faint",
  watching: "hero",
  priority_assist: "danger",
};

const DOT: Record<TimelineItem["when"], string> = { past: "bg-surface-muted", today: "bg-surface-info", ahead: "bg-surface-primary" };

/** The dated facts from the rule engine: what changed, when CareLoop spoke up, what is coming. */
function Timeline({ items }: { items: TimelineItem[] }) {
  if (!items.length) return null;
  // Only an early heads-up comes before the trouble; after a missed repayment there is nothing to contrast.
  const early = items.some((i) => i.when === "today" && i.label.startsWith("Early heads-up"));
  const missed = early ? items.find((i) => i.when === "ahead") : undefined;
  return (
    <div className="mb-3 rounded-lg bg-background-faint p-3">
      <div className="mb-2 text-[11px] font-bold uppercase text-text-muted">How CareLoop noticed</div>
      <ol className="flex">
        {items.map((item, i) => (
          <li key={item.date + item.label} className="relative flex-1 pr-3">
            {i < items.length - 1 && <span className="absolute left-2 right-0 top-[5px] h-px bg-surface-muted-soft" />}
            <span className={`relative block h-2.5 w-2.5 rounded-full ${DOT[item.when]}`} />
            <div className="mt-1 text-[11px] font-bold text-text-heading">{item.when === "today" ? `Today, ${shortDate(item.date)}` : shortDate(item.date)}</div>
            <div className="text-[12px] leading-snug">{item.label}</div>
          </li>
        ))}
      </ol>
      {missed && (
        <p className="mt-2 text-[11px] text-text-muted">Without the early heads-up, the first contact would come after the missed repayment on {shortDate(missed.date)}.</p>
      )}
    </div>
  );
}

type Band = NonNullable<QueueRow["ml"]["band"]>;
const BANDS: Band[] = ["Low", "Elevated", "High"];
const BAND_ON: Record<Band, string> = {
  Low: "bg-surface-success font-bold text-text-mono",
  Elevated: "bg-surface-warning font-bold text-text-mono",
  High: "bg-surface-danger font-bold text-text-mono",
};

const TONE: Record<QueueRow["brief"]["headline"]["tone"], string> = {
  danger: "border-l-border-primary bg-surface-primary-faint text-text-primary",
  warning: "border-l-border-warning bg-surface-warning-faint text-text-warning",
  neutral: "border-l-border-muted-mild bg-background-faint text-text-heading",
};

/** Bold only the figure inside a phrase: "income covers **83%** of bills". */
function Emphasis({ text, strong }: { text: string; strong?: string }) {
  const at = strong ? text.indexOf(strong) : -1;
  if (!strong || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="font-bold text-text-heading">{strong}</span>
      {text.slice(at + strong.length)}
    </>
  );
}

/** The quick read: what matters most, then each warning signal against the rule's line. */
function Brief({ brief }: { brief: QueueRow["brief"] }) {
  return (
    <div>
      <div className={`rounded-md border-l-4 px-3 py-2 ${TONE[brief.headline.tone]}`}>
        <div className="text-[16px] font-bold leading-tight">{brief.headline.title}</div>
        <div className="mt-0.5 text-[12px] text-text-muted">{brief.headline.detail}</div>
      </div>
      {brief.signals.length > 0 && (
        <table className="mt-2 w-full text-left text-[12px]">
          <thead className="text-[10px] uppercase text-text-muted">
            <tr>
              <th className="py-1 font-normal">Warning signal ({brief.signals.length})</th>
              <th className="py-1 font-normal">This customer</th>
              <th className="py-1 font-normal">Flags when</th>
            </tr>
          </thead>
          <tbody>
            {brief.signals.map((s) => (
              <tr key={s.code} className="border-t border-border-muted-soft">
                <td className="py-1 pr-2">{s.label}</td>
                <td className="py-1 pr-2 tabular-nums text-text-body">
                  <Emphasis text={s.value} strong={s.strong} />
                </td>
                <td className="py-1 text-text-muted">{s.line}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!brief.signals.length && <p className="mt-2 text-[12px] text-text-muted">No warning signals.</p>}
      {brief.note && <p className="mt-1 text-[11px] text-text-muted">{brief.note}</p>}
    </div>
  );
}

const WHO: Record<QueueRow["chat"]["entries"][number]["who"], string> = {
  customer: "Customer",
  careloop: "CareLoop",
  staff: "Westpac",
  event: "",
};

/** The conversation so far, so the person who joins never asks the customer to repeat themselves. */
function ChatSoFarPanel({ chat }: { chat: QueueRow["chat"] }) {
  if (!chat.entries.length) return null;
  return (
    <div className="mt-3 rounded-lg border border-border-muted-soft p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase text-text-muted">Chat so far</span>
        <span className="text-[12px] font-bold text-text-heading">{chat.stage}</span>
        <span className="text-[11px] text-text-muted">· permission to look at accounts: {chat.consent ? "given" : "not given"}</span>
      </div>
      {chat.earlier > 0 && <div className="mt-1 text-[11px] text-text-muted">{chat.earlier} earlier messages not shown</div>}
      <ol className="mt-2 space-y-1 text-[12px]">
        {chat.entries.map((e, i) =>
          e.who === "event" ? (
            <li key={i} className="text-[11px] italic text-text-muted">— {e.text}</li>
          ) : (
            <li key={i} className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
              <span className={`text-[11px] font-bold ${e.who === "customer" ? "text-text-hero" : "text-text-muted"}`}>{WHO[e.who]}</span>
              <span className={e.who === "customer" ? "text-text-body" : "text-text-muted"}>{e.text}</span>
            </li>
          ),
        )}
      </ol>
      {chat.draft.length > 0 && (
        <div className="mt-2 border-t border-border-muted-soft pt-2">
          <div className="text-[11px] text-text-muted">Unsent request draft</div>
          <ul className="mt-1 space-y-0.5 text-[12px]">
            {chat.draft.map((f) => (
              <li key={f.field}>
                <span className="text-text-muted">{f.label}:</span> {f.value}
                <span className="text-[11px] text-text-muted"> · {f.source === "you_told_us" ? "customer said" : "from accounts"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The ML service's score as a second opinion. Shown beside the tier, never used to set it. */
function MlSecondOpinion({ ml }: { ml: QueueRow["ml"] }) {
  if (ml.status !== "available" || !ml.band) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-border-muted-soft p-3 text-[12px] text-text-muted">
        ML second opinion: {ml.status === "not_applicable" ? "no repayment due in the next 14 days, so no score" : "model not available"}.
      </div>
    );
  }
  const largest = Math.max(...ml.drivers.map((d) => Math.abs(d.contribution)), 0.01);
  return (
    <div className="mt-3 rounded-lg border border-dashed border-border-muted-mild p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase text-text-muted">ML second opinion</span>
        {/* The three bands side by side, this customer's one lit, so staff see where it sits. */}
        <span className="inline-flex overflow-hidden rounded-sm border border-border-muted-soft text-[11px]" aria-label={`ML risk band: ${ml.band}`}>
          {BANDS.map((band) => (
            <span
              key={band}
              className={`border-r border-border-muted-soft px-2 py-0.5 last:border-r-0 ${band === ml.band ? BAND_ON[band] : "bg-background-white text-text-muted"}`}
            >
              {band}
            </span>
          ))}
        </span>
        <span className="text-[11px] text-text-muted">
          {ml.aboveThreshold ? "Above" : "Below"} the model&apos;s flag line · does not change the tier
        </span>
      </div>
      <div className="mt-2 text-[11px] text-text-muted">Biggest factors in this score</div>
      <ul className="mt-1 space-y-1">
        {ml.drivers.map((d) => (
          <li key={d.feature} className="grid grid-cols-[minmax(0,1fr)_120px_52px] items-center gap-2 text-[12px]">
            <span className="truncate" title={d.feature}>{d.label}</span>
            <span className="h-1.5 rounded-full bg-surface-muted-pale">
              <span
                className={`block h-1.5 rounded-full ${d.contribution > 0 ? "bg-surface-primary" : "bg-surface-success"}`}
                style={{ width: `${Math.max(3, (Math.abs(d.contribution) / largest) * 100)}%` }}
              />
            </span>
            <span className="text-right tabular-nums text-text-muted">{d.contribution > 0 ? "+" : ""}{d.contribution.toFixed(2)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-snug text-text-muted">
        Logistic regression on 1,000 synthetic customers. A ranking, not a probability. Red raises the score, green lowers it.
      </p>
    </div>
  );
}

export function StaffConsole({
  queue,
  report,
  tab,
  onTab,
  selected,
  onSelect,
  onReply,
  onStartReview,
  onDecide,
}: {
  queue: QueueRow[];
  /** The latest nightly report, if one has run. */
  report: NightlyReport | null;
  tab: "queue" | "report";
  onTab: (tab: "queue" | "report") => void;
  selected: CustomerId | null;
  onSelect: (id: CustomerId) => void;
  onReply: (id: CustomerId, text: string) => void;
  onStartReview: (id: CustomerId) => void;
  onDecide: (id: CustomerId, outcome: DecisionKey) => void;
}) {
  const [reply, setReply] = useState("");
  const [outcome, setOutcome] = useState<DecisionKey>("lower_repayments");
  const row = queue.find((r) => r.customerId === selected) ?? queue[0];
  const firstName = row?.customerName.split(" ")[0] ?? "";

  return (
    <div className="flex h-[760px] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-muted-soft bg-background-white shadow-sm">
      <header className="flex items-center gap-3 border-b-4 border-border-primary bg-surface-hero px-4 py-3 text-text-mono">
        <span className="flex items-center rounded-sm bg-background-white px-1.5 py-1">
          <WBCLogo className="h-[18px] w-[44px]" aria-label="Westpac" />
        </span>
        <div>
          <div className="text-[15px] font-bold">Staff console · Westpac Assist</div>
          <div className="text-[11px] opacity-80">Prototype on sample data. Staff make every decision.</div>
        </div>
      </header>

      <nav className="flex border-b border-border-muted-soft bg-background-faint text-[13px]" role="tablist" aria-label="Staff views">
        {(["queue", "report"] as const).map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={tab === name}
            onClick={() => onTab(name)}
            className={`relative cursor-pointer px-4 py-2 ${tab === name ? "bg-background-white font-bold text-text-hero" : "text-text-muted hover:text-text-hero"}`}
          >
            {name === "queue" ? "Customers" : "Nightly report"}
            {name === "report" && report && tab !== "report" && <span className="ml-1.5 inline-block size-2 rounded-full bg-surface-primary align-middle" aria-label="New report" />}
            {tab === name && <span className="absolute inset-x-0 bottom-0 h-[3px] bg-surface-primary" />}
          </button>
        ))}
      </nav>

      {tab === "report" && <ReportView report={report} />}

      {tab === "queue" && <table className="w-full text-left text-[13px]">
        <thead className="bg-background-faint text-[11px] uppercase text-text-muted">
          <tr>
            <th className="px-4 py-2 font-normal">Customer</th>
            <th className="py-2 pr-3 font-normal">Tier</th>
            <th className="py-2 pr-3 font-normal">Respond by</th>
            <th className="py-2 font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {queue.map((r) => (
            <tr
              key={r.customerId}
              onClick={() => onSelect(r.customerId)}
              className={`cursor-pointer border-t border-border-muted-soft ${r.customerId === row?.customerId ? "bg-surface-hero-faint" : "hover:bg-surface-muted-faint"}`}
            >
              <td className="px-4 py-2 font-bold">
                {r.customerName}
                {r.note && (
                  <Badge color="primary" soft className="ml-2 align-middle font-normal">
                    {r.note}
                  </Badge>
                )}
              </td>
              <td className="py-2 pr-3">{r.tier}</td>
              <td className="py-2">{r.case?.decision ? "Done" : r.respondBy ? shortDate(r.respondBy) : "-"}</td>
              <td className="py-2">
                <Badge color={STATUS_COLOR[r.status]} soft>
                  {STATUS[r.status]}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>}

      {tab === "queue" && row && (
        <section className="m-4 flex-1 overflow-y-auto rounded-lg border border-border-muted-soft p-4 text-[13px]">
          <Timeline items={row.timeline} />
          <div className="text-[14px] font-bold text-text-heading">Case summary · {row.customerName}</div>
          <div className="mb-2 text-[11px] text-text-muted">
            {row.case ? `${row.case.id} · prepared by CareLoop; a person decides` : `No request yet · Tier ${row.tier} from the risk rules`}
          </div>
          <Brief brief={row.brief} />
          {row.case && (
            // The request's own lines: the customer's story and asks. Signals already in the brief are left out.
            <ul className="mt-3 space-y-0.5">
              {row.case.summary.filter((line) => !row.reasons.includes(line)).map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
          <MlSecondOpinion ml={row.ml} />
          <ChatSoFarPanel chat={row.chat} />

          {row.case && row.case.draft.fields.length > 0 && (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-border-muted-soft pt-3">
              {row.case.draft.fields.map((f) => (
                <div key={f.field}>
                  <dt className="text-[11px] text-text-muted">
                    {f.label} · {f.source === "you_told_us" ? "customer said" : "from accounts"}
                  </dt>
                  <dd className="font-medium">{f.value}</dd>
                  {f.evidence && <dd className="text-[11px] italic text-text-muted">&ldquo;{f.evidence}&rdquo;</dd>}
                </div>
              ))}
            </dl>
          )}

          {row.case?.decision ? (
            <p className="mt-3 font-bold text-text-info">
              Decision recorded: {row.case.decision.outcome}
              {row.case.decision.approved && `. CareLoop checks in on ${shortDate(row.case.decision.reviewOn, true)}.`}
            </p>
          ) : (
            row.respondBy && <p className="mt-3 font-bold text-text-info">Respond by {shortDate(row.respondBy, true)} (21 days)</p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {/* The first two write a draft into the reply box; the staff member edits and sends it. */}
            <Button className="!text-[13px] font-medium" size="small" look="primary" soft onClick={() => setReply(`Hi ${firstName}, this is the Westpac Assist team. Thanks for your request. To look at it properly, could you tell us a little more about `)}>
              Ask for info
            </Button>
            <Button className="!text-[13px] font-medium" size="small" look="primary" soft onClick={() => setReply(`Hi ${firstName}, this is the Westpac Assist team. Would a short call suit you? Tell us a day and time that works and we'll ring you.`)}>
              Book a call
            </Button>
            {row.case?.status === "new" && (
              <Button className="!text-[13px] font-medium" size="small" look="primary" onClick={() => onStartReview(row.customerId)}>
                Start review
              </Button>
            )}
          </div>

          {/* The decision is a person's. CareLoop passes it on and books the check-in. */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {row.case?.status === "in_review" && (
              <>
                <Select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value as DecisionKey)}
                  aria-label="Decision"
                  size="small"
                  width="auto"
                  className="!text-[13px]"
                >
                  {(Object.keys(DECISIONS) as DecisionKey[]).map((key) => (
                    <option key={key} value={key}>{DECISIONS[key].label}</option>
                  ))}
                </Select>
                <Button className="!text-[13px] font-medium" size="small" look="primary" onClick={() => onDecide(row.customerId, outcome)}>
                  Record decision
                </Button>
              </>
            )}
          </div>

          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!reply.trim()) return;
              onReply(row.customerId, reply.trim());
              setReply("");
            }}
          >
            <Input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={`Reply in ${row.customerName.split(" ")[0]}'s chat`}
              aria-label="Reply to customer"
              className="min-w-0 flex-1 !text-[13px]"
            />
            <Button className="!text-[13px] font-medium" look="primary" type="submit">Send</Button>
          </form>
        </section>
      )}
    </div>
  );
}
