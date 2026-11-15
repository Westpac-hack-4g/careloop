"use client";

import { Button } from "@westpac/ui/button";
import { useState } from "react";
import type { CaseStatus, CustomerId, QueueRow, TimelineItem } from "@/lib/contract";
import { DECISIONS, type DecisionKey } from "@/lib/decisions";
import { shortDate } from "@/lib/client/api";

const STATUS: Record<CaseStatus, string> = {
  new: "New",
  in_review: "In review",
  arrangement: "Arrangement in place",
  closed: "Closed",
  watching: "Watching",
  priority_assist: "Priority Assist",
};

const DOT: Record<TimelineItem["when"], string> = { past: "bg-[#575f65]", today: "bg-[#1f5fd0]", ahead: "bg-[#da1710]" };

/** The dated facts from the rule engine: what changed, when CareLoop spoke up, what is coming. */
function Timeline({ items }: { items: TimelineItem[] }) {
  if (!items.length) return null;
  // Only an early heads-up comes before the trouble; after a missed repayment there is nothing to contrast.
  const early = items.some((i) => i.when === "today" && i.label.startsWith("Early heads-up"));
  const missed = early ? items.find((i) => i.when === "ahead") : undefined;
  return (
    <div className="mb-3 rounded-lg bg-[#f7f7f8] p-3">
      <div className="mb-2 text-[11px] font-bold uppercase text-[#575f65]">How CareLoop noticed</div>
      <ol className="flex">
        {items.map((item, i) => (
          <li key={item.date + item.label} className="relative flex-1 pr-3">
            {i < items.length - 1 && <span className="absolute left-2 right-0 top-[5px] h-px bg-[#c9cdd1]" />}
            <span className={`relative block h-2.5 w-2.5 rounded-full ${DOT[item.when]}`} />
            <div className="mt-1 text-[11px] font-bold text-[#1f1c4f]">{item.when === "today" ? `Today, ${shortDate(item.date)}` : shortDate(item.date)}</div>
            <div className="text-[12px] leading-snug">{item.label}</div>
          </li>
        ))}
      </ol>
      {missed && (
        <p className="mt-2 text-[11px] text-[#575f65]">Without the early heads-up, the first contact would come after the missed repayment on {shortDate(missed.date)}.</p>
      )}
    </div>
  );
}

export function StaffConsole({
  queue,
  selected,
  onSelect,
  onReply,
  onStartReview,
  onDecide,
}: {
  queue: QueueRow[];
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
    <div className="flex h-[760px] min-w-0 flex-1 flex-col rounded-xl border border-[#d7d2cb] bg-white">
      <header className="border-b border-[#d7d2cb] px-4 py-3">
        <div className="text-[15px] font-bold text-[#1f1c4f]">Staff console · Westpac Assist</div>
        <div className="text-[11px] text-[#575f65]">Prototype on sample data. Staff make every decision.</div>
      </header>

      <table className="w-full text-left text-[13px]">
        <thead className="text-[11px] uppercase text-[#575f65]">
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
              className={`cursor-pointer border-t border-[#eee] ${r.customerId === row?.customerId ? "bg-[#eef0f4]" : "hover:bg-[#f7f7f8]"}`}
            >
              <td className="px-4 py-2 font-bold">
                {r.customerName}
                {r.note && <span className="ml-2 rounded bg-[#fdeeee] px-1.5 py-px text-[10px] font-normal text-[#99000d]">{r.note}</span>}
              </td>
              <td className="py-2 pr-3">{r.tier}</td>
              <td className="py-2">{r.case?.decision ? "Done" : r.respondBy ? shortDate(r.respondBy) : "-"}</td>
              <td className="py-2">{STATUS[r.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {row && (
        <section className="m-4 flex-1 overflow-y-auto rounded-lg border border-[#d7d2cb] p-4 text-[13px]">
          <Timeline items={row.timeline} />
          <div className="text-[14px] font-bold text-[#1f1c4f]">Case summary · {row.customerName}</div>
          <div className="mb-2 text-[11px] text-[#575f65]">
            {row.case ? `${row.case.id} · prepared by CareLoop; a person decides` : "No request yet. Signals from the rule engine:"}
          </div>
          <ul className="space-y-0.5">
            {(row.case?.summary ?? row.reasons).map((line) => <li key={line}>{line}</li>)}
            {!row.case && !row.reasons.length && <li>No risk signals.</li>}
          </ul>

          {row.case && row.case.draft.fields.length > 0 && (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-[#eee] pt-3">
              {row.case.draft.fields.map((f) => (
                <div key={f.field}>
                  <dt className="text-[11px] text-[#575f65]">
                    {f.label} · {f.source === "you_told_us" ? "customer said" : "from accounts"}
                  </dt>
                  <dd className="font-medium">{f.value}</dd>
                  {f.evidence && <dd className="text-[11px] italic text-[#575f65]">&ldquo;{f.evidence}&rdquo;</dd>}
                </div>
              ))}
            </dl>
          )}

          {row.case?.decision ? (
            <p className="mt-3 font-bold text-[#1f5fd0]">
              Decision recorded: {row.case.decision.outcome}
              {row.case.decision.approved && `. CareLoop checks in on ${shortDate(row.case.decision.reviewOn, true)}.`}
            </p>
          ) : (
            row.respondBy && <p className="mt-3 font-bold text-[#1f5fd0]">Respond by {shortDate(row.respondBy, true)} (21 days)</p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {/* The first two write a draft into the reply box; the staff member edits and sends it. */}
            <Button size="small" look="primary" soft onClick={() => setReply(`Hi ${firstName}, this is the Westpac Assist team. Thanks for your request. To look at it properly, could you tell us a little more about `)}>
              Ask for info
            </Button>
            <Button size="small" look="primary" soft onClick={() => setReply(`Hi ${firstName}, this is the Westpac Assist team. Would a short call suit you? Tell us a day and time that works and we'll ring you.`)}>
              Book a call
            </Button>
            {row.case?.status === "new" && (
              <Button size="small" look="primary" onClick={() => onStartReview(row.customerId)}>
                Start review
              </Button>
            )}
          </div>

          {/* The decision is a person's. CareLoop passes it on and books the check-in. */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {row.case?.status === "in_review" && (
              <>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value as DecisionKey)}
                  aria-label="Decision"
                  className="rounded border border-[#d7d2cb] px-2 py-1.5 text-[13px]"
                >
                  {(Object.keys(DECISIONS) as DecisionKey[]).map((key) => (
                    <option key={key} value={key}>{DECISIONS[key].label}</option>
                  ))}
                </select>
                <Button size="small" look="primary" onClick={() => onDecide(row.customerId, outcome)}>
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
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={`Reply in ${row.customerName.split(" ")[0]}'s chat`}
              aria-label="Reply to customer"
              className="min-w-0 flex-1 rounded border border-[#d7d2cb] px-3 py-2 text-[13px] outline-none focus:border-[#1f1c4f]"
            />
            <Button size="small" look="primary" type="submit">Send</Button>
          </form>
        </section>
      )}
    </div>
  );
}
