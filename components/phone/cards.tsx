"use client";

import { Badge } from "@westpac/ui/badge";
import { Button } from "@westpac/ui/button";
import { SecurityIcon, WarningIcon } from "@westpac/ui/icon";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Card, DraftRequest, Projection } from "@/lib/contract";
import { money, shortDate } from "@/lib/client/api";

// One component per card type. The chat renders a card through <ChatCard>.
// `live` is true only for the newest card of its kind, so old buttons go quiet.

type Act = (action: string) => void;

const Shell = ({ title, children }: { title?: string; children: React.ReactNode }) => (
  <div className="rounded-xl border border-border-muted-soft bg-background-white p-3 text-[13px] leading-snug text-text-body shadow-sm">
    {title && <div className="mb-1.5 border-b border-border-muted-soft pb-1.5 text-[14px] font-bold text-text-heading">{title}</div>}
    {children}
  </div>
);

const Buttons = ({ children }: { children: React.ReactNode }) => <div className="mt-2.5 flex flex-wrap gap-1.5">{children}</div>;

function AlertCard({ shortfall, date, text, callback, act, live }: { shortfall?: number; date?: string; text?: string; callback?: boolean; act: Act; live: boolean }) {
  return (
    <div className="rounded-xl border border-l-4 border-border-muted-soft border-l-border-primary bg-background-white p-3 text-[13px] text-text-body shadow-sm">
      <div className="flex items-center gap-1.5 text-[14px] font-bold text-text-heading">
        <WarningIcon size="small" color="primary" aria-hidden /> Heads up
      </div>
      <p className="mt-1">{shortfall && date ? `You may be ${money(shortfall)} short before your ${shortDate(date)} repayment.` : text}</p>
      {live && callback && (
        // Tier 3: a person first. Same-day message, call back by the next business day.
        <Buttons>
          <Button className="!text-[13px] font-medium" size="small" look="primary" onClick={() => act("request_callback")}>Ask for a call back</Button>
          <Button className="!text-[13px] font-medium" size="small" look="primary" soft onClick={() => act("show_why")}>Show me why</Button>
          <Button className="!text-[13px] font-medium" size="small" look="faint" onClick={() => act("not_now")}>Not now</Button>
        </Buttons>
      )}
      {live && !callback && (
        <Buttons>
          <Button className="!text-[13px] font-medium" size="small" look="primary" onClick={() => act("show_why")}>Show me why</Button>
          <Button className="!text-[13px] font-medium" size="small" look="primary" soft onClick={() => act("talk_to_someone")}>Talk to someone</Button>
          <Button className="!text-[13px] font-medium" size="small" look="faint" onClick={() => act("not_now")}>Not now</Button>
          <Button className="!text-[13px] font-medium" size="small" look="faint" onClick={() => act("not_right")}>This isn&apos;t right</Button>
        </Buttons>
      )}
    </div>
  );
}

function ConsentCard({ act, live }: { act: Act; live: boolean }) {
  return (
    <Shell title="Your permission">
      <p>To check, I&apos;ll look at your last 90 days of transactions, only for this.</p>
      {live && (
        <Buttons>
          <Button className="!text-[13px] font-medium" size="small" look="primary" onClick={() => act("allow")}>Allow</Button>
          <Button className="!text-[13px] font-medium" size="small" look="faint" onClick={() => act("decline_consent")}>Not now</Button>
        </Buttons>
      )}
    </Shell>
  );
}

function ProjectionCard({ projection, act, live }: { projection: Projection; act: Act; live: boolean }) {
  const data = projection.points.map((p) => ({ ...p, label: shortDate(p.date) }));
  return (
    <Shell title={`Your next ${projection.points.length - 1} days`}>
      <div className="h-36 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -14 }}>
            <CartesianGrid stroke="var(--border-muted-soft)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: "var(--text-muted)" }} stroke="var(--border-muted-mild)" interval={2} />
            <YAxis tick={{ fontSize: 9, fill: "var(--text-muted)" }} stroke="var(--border-muted-mild)" tickFormatter={(v: number) => money(v)} />
            <Tooltip formatter={(v) => money(Number(v))} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11, borderColor: "var(--border-muted-soft)" }} />
            <ReferenceLine y={0} stroke="var(--border-primary)" strokeDasharray="4 3" />
            <Line type="stepAfter" dataKey="balance" stroke="var(--border-hero)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {projection.shortfall && (
        <p className="mt-1 font-bold text-text-primary">
          {money(-projection.shortfall.amount)} on {shortDate(projection.shortfall.date)}
        </p>
      )}
      <ul className="mt-1.5 list-disc pl-4 text-[12px] text-text-muted">
        {projection.assumptions.map((a) => <li key={a}>{a}</li>)}
      </ul>
      {live && (
        <Buttons>
          <Button className="!text-[13px] font-medium" size="small" look="primary" onClick={() => act("prepare_request")}>Prepare a request</Button>
          <Button className="!text-[13px] font-medium" size="small" look="faint" onClick={() => act("not_right")}>This isn&apos;t right</Button>
        </Buttons>
      )}
    </Shell>
  );
}

function DraftFields({ draft }: { draft: DraftRequest }) {
  return (
    <dl className="space-y-1.5">
      {draft.fields.map((f) => (
        <div key={f.field}>
          <dt className="text-[11px] text-text-muted">
            {f.label}{" "}
            <Badge color={f.source === "you_told_us" ? "primary" : "hero"} soft className="ml-0.5 align-middle">
              {f.source === "you_told_us" ? "You told us" : "From your accounts"}
            </Badge>
          </dt>
          <dd className="font-medium">{f.value}</dd>
        </div>
      ))}
      {draft.missing.map((m) => (
        <div key={m.field}>
          <dt className="text-[11px] text-text-muted">{m.label}</dt>
          <dd className="italic text-text-muted/60">Still to add</dd>
        </div>
      ))}
    </dl>
  );
}

const DraftCard = ({ draft }: { draft: DraftRequest }) => (
  <Shell title="Your request (draft)">
    <DraftFields draft={draft} />
  </Shell>
);

function ReviewCard({ draft, act, live }: { draft: DraftRequest; act: Act; live: boolean }) {
  return (
    <Shell title="Check your request">
      <DraftFields draft={draft} />
      <p className="mt-2 text-[12px] text-text-muted">Something wrong? Just tell me and I&apos;ll change it.</p>
      {live && (
        <Buttons>
          <Button className="!text-[13px] font-medium" size="small" look="primary" onClick={() => act("confirm_review")}>Looks right</Button>
        </Buttons>
      )}
    </Shell>
  );
}

function StartRequestCard({ act, live }: { act: Act; live: boolean }) {
  return (
    <Shell title="Would you like to start a request for help?">
      <p>If you say yes, it goes to the Westpac Assist team now. A person decides, and they must reply within 21 days.</p>
      {live && (
        <Buttons>
          <Button className="!text-[13px] font-medium" size="small" look="primary" onClick={() => act("start_yes")}>Yes, start</Button>
          <Button className="!text-[13px] font-medium" size="small" look="faint" onClick={() => act("start_not_yet")}>Not yet</Button>
          <Button className="!text-[13px] font-medium" size="small" look="primary" soft onClick={() => act("start_talk")}>Talk to someone</Button>
        </Buttons>
      )}
    </Shell>
  );
}

/** Tier 1: a few self-help steps, each from a Westpac page. */
function MoneyCheckCard({ items }: { items: Extract<Card, { type: "money_check" }>["items"] }) {
  return (
    <Shell title="A quick money check">
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.title}>
            <div className="font-bold text-text-heading">{item.title}</div>
            <p>{item.text}</p>
            <a href={item.source.url} target="_blank" rel="noreferrer" className="text-[11px] text-text-link underline">
              {item.source.title}
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-text-muted">Want to set up a change to your repayments anyway? Just tell me.</p>
    </Shell>
  );
}

/** Tier 3: a person calls by the next business day. */
function CallbackCard({ caseId, callbackBy }: { caseId: string; callbackBy: string }) {
  return (
    <Shell title="A call back is booked">
      <p>
        A person from the Westpac Assist team will call you by <span className="font-bold">{shortDate(callbackBy, true)}</span>.
      </p>
      <p className="mt-1 text-[12px] text-text-muted">
        Case <span className="font-bold">{caseId}</span>. They can already see your accounts and this chat.
      </p>
      <p className="mt-2 text-[11px] text-text-muted">Prototype: simulated handover. Nothing is sent to Westpac.</p>
    </Shell>
  );
}

function ReceiptCard({ caseId, respondBy }: { caseId: string; respondBy: string }) {
  return (
    <Shell title="Request received">
      <p>
        Case <span className="font-bold">{caseId}</span>
      </p>
      <p className="mt-1 font-bold text-text-heading">We&apos;ll respond by {shortDate(respondBy, true)}.</p>
      <ol className="mt-2 space-y-0.5 text-[12px]">
        <li>● Received today</li>
        <li className="text-text-muted/60">○ A Westpac person reviews it</li>
        <li className="text-text-muted/60">○ Decision explained to you</li>
      </ol>
      <p className="mt-2 text-[11px] text-text-muted">Prototype: simulated handover. Nothing is sent to Westpac.</p>
    </Shell>
  );
}

function DecisionCard({ outcome, approved, reviewOn }: { outcome: string; approved: boolean; reviewOn: string }) {
  return (
    <Shell title="Decision from Westpac Assist">
      {approved ? (
        <>
          <p>
            A person in the Westpac Assist team has approved: <span className="font-bold">{outcome}</span>.
          </p>
          <p className="mt-1">They will confirm the details in writing.</p>
          <p className="mt-2 font-bold text-text-heading">I&apos;ll check in with you on {shortDate(reviewOn, true)} to see how things are going.</p>
        </>
      ) : (
        <>
          <p>The Westpac Assist team could not offer a change this time.</p>
          <p className="mt-1">A team member will contact you to explain why and talk through other options.</p>
        </>
      )}
      <ol className="mt-2 space-y-0.5 text-[12px]">
        <li>● Received</li>
        <li>● A Westpac person reviewed it</li>
        <li>● Decision explained to you</li>
      </ol>
    </Shell>
  );
}

function CheckInCard({ recovered, payNow, outcome, act, live }: { recovered: boolean; payNow: number; outcome: string; act: Act; live: boolean }) {
  return (
    <Shell title="Checking in, as promised">
      <p>
        {recovered
          ? `Your pay over the last 4 weeks is back to about ${money(payNow)}.`
          : `Your pay over the last 4 weeks is still about ${money(payNow)}, the same as when we set this up.`}
      </p>
      <p className="mt-1">
        Your arrangement is still running: <span className="font-bold">{outcome}</span>.
      </p>
      <p className="mt-1">{recovered ? "Would you like to go back to your normal repayments?" : "Would more time help?"}</p>
      {live && (
        <Buttons>
          {recovered ? (
            <Button className="!text-[13px] font-medium" size="small" look="primary" onClick={() => act("checkin_return")}>Go back to normal</Button>
          ) : (
            <Button className="!text-[13px] font-medium" size="small" look="primary" onClick={() => act("checkin_extend")}>Ask for more time</Button>
          )}
          <Button className="!text-[13px] font-medium" size="small" look="faint" onClick={() => act("checkin_keep")}>{recovered ? "Keep the arrangement" : "I'm OK for now"}</Button>
          <Button className="!text-[13px] font-medium" size="small" look="primary" soft onClick={() => act("talk_to_someone")}>Talk to someone</Button>
        </Buttons>
      )}
      <p className="mt-2 text-[11px] text-text-muted">Prototype: four weeks later, simulated.</p>
    </Shell>
  );
}

const HandoverCard = () => (
  <div className="rounded-xl border border-l-4 border-border-muted-soft border-l-border-hero bg-background-white p-3 text-[13px] text-text-body shadow-sm">
    <div className="flex items-center gap-1.5 text-[14px] font-bold text-text-heading">
      <SecurityIcon size="small" color="hero" aria-hidden /> Your safety matters most
    </div>
    <p className="mt-1">
      I&apos;ve stopped the form. Westpac&apos;s Priority Assist team are specialists and will take it from here. You won&apos;t need to explain again.
    </p>
    <p className="mt-1.5 text-[12px]">In danger now? Call 000. 1800RESPECT: 1800 737 732.</p>
    <Buttons>
      <Button className="!text-[13px] font-medium" size="small" look="faint" tag="a" href="https://www.google.com">Quick exit</Button>
    </Buttons>
  </div>
);

export function ChatCard({ card, act, live }: { card: Card; act: Act; live: boolean }) {
  switch (card.type) {
    case "alert":
      return <AlertCard shortfall={card.shortfall} date={card.date} text={card.text} callback={card.callback} act={act} live={live} />;
    case "money_check":
      return <MoneyCheckCard items={card.items} />;
    case "callback":
      return <CallbackCard caseId={card.caseId} callbackBy={card.callbackBy} />;
    case "closed":
      return <p className="py-1 text-center text-[11px] text-text-muted">Chat closed. Message any time to start again.</p>;
    case "consent":
      return <ConsentCard act={act} live={live} />;
    case "projection":
      return <ProjectionCard projection={card.projection} act={act} live={live} />;
    case "draft":
      return <DraftCard draft={card.draft} />;
    case "review":
      return <ReviewCard draft={card.draft} act={act} live={live} />;
    case "start_request":
      return <StartRequestCard act={act} live={live} />;
    case "receipt":
      return <ReceiptCard caseId={card.caseId} respondBy={card.respondBy} />;
    case "decision":
      return <DecisionCard outcome={card.outcome} approved={card.approved} reviewOn={card.reviewOn} />;
    case "check_in":
      return <CheckInCard recovered={card.recovered} payNow={card.payNow} outcome={card.outcome} act={act} live={live} />;
    case "handover":
      return <HandoverCard />;
  }
}
