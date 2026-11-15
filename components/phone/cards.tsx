"use client";

import { Button } from "@westpac/ui/button";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Card, DraftRequest, Projection } from "@/lib/contract";
import { money, shortDate } from "@/lib/client/api";

// One component per card type. The chat renders a card through <ChatCard>.
// `live` is true only for the newest card of its kind, so old buttons go quiet.

type Act = (action: string) => void;

const Shell = ({ title, children }: { title?: string; children: React.ReactNode }) => (
  <div className="rounded-xl border border-[#d7d2cb] bg-white p-3 text-[13px] leading-snug shadow-sm">
    {title && <div className="mb-1.5 text-[14px] font-bold text-[#1f1c4f]">{title}</div>}
    {children}
  </div>
);

const Buttons = ({ children }: { children: React.ReactNode }) => <div className="mt-2.5 flex flex-wrap gap-1.5">{children}</div>;

function AlertCard({ shortfall, date, act, live }: { shortfall: number; date: string; act: Act; live: boolean }) {
  return (
    <div className="rounded-xl border-l-4 border-[#da1710] bg-white p-3 text-[13px] shadow-sm">
      <div className="text-[14px] font-bold text-[#1f1c4f]">Heads up</div>
      <p className="mt-1">
        You may be {money(shortfall)} short before your {shortDate(date)} repayment.
      </p>
      {live && (
        <Buttons>
          <Button size="small" look="primary" onClick={() => act("show_why")}>Show me why</Button>
          <Button size="small" look="primary" soft onClick={() => act("talk_to_someone")}>Talk to someone</Button>
          <Button size="small" look="faint" onClick={() => act("not_now")}>Not now</Button>
          <Button size="small" look="faint" onClick={() => act("not_right")}>This isn&apos;t right</Button>
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
          <Button size="small" look="primary" onClick={() => act("allow")}>Allow</Button>
          <Button size="small" look="faint" onClick={() => act("decline_consent")}>Not now</Button>
        </Buttons>
      )}
    </Shell>
  );
}

function ProjectionCard({ projection, act, live }: { projection: Projection; act: Act; live: boolean }) {
  const data = projection.points.map((p) => ({ ...p, label: shortDate(p.date) }));
  return (
    <Shell title="Your next 30 days">
      <div className="h-36 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -14 }}>
            <CartesianGrid stroke="#eee" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={6} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={(v: number) => money(v)} />
            <Tooltip formatter={(v) => money(Number(v))} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="#da1710" strokeDasharray="4 3" />
            <Line type="stepAfter" dataKey="balance" stroke="#1f1c4f" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {projection.shortfall && (
        <p className="mt-1 font-bold text-[#da1710]">
          {money(-projection.shortfall.amount)} on {shortDate(projection.shortfall.date)}
        </p>
      )}
      <ul className="mt-1.5 list-disc pl-4 text-[12px] text-[#575f65]">
        {projection.assumptions.map((a) => <li key={a}>{a}</li>)}
      </ul>
      {live && (
        <Buttons>
          <Button size="small" look="primary" onClick={() => act("prepare_request")}>Prepare a request</Button>
          <Button size="small" look="faint" onClick={() => act("not_right")}>This isn&apos;t right</Button>
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
          <dt className="text-[11px] text-[#575f65]">
            {f.label}{" "}
            <span className={`rounded px-1 py-px text-[10px] ${f.source === "you_told_us" ? "bg-[#fdeeee] text-[#99000d]" : "bg-[#eef0f4] text-[#1f1c4f]"}`}>
              {f.source === "you_told_us" ? "You told us" : "From your accounts"}
            </span>
          </dt>
          <dd className="font-medium">{f.value}</dd>
        </div>
      ))}
      {draft.missing.map((m) => (
        <div key={m.field}>
          <dt className="text-[11px] text-[#575f65]">{m.label}</dt>
          <dd className="italic text-[#a0a5a8]">Still to add</dd>
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
      <p className="mt-2 text-[12px] text-[#575f65]">Something wrong? Just tell me and I&apos;ll change it.</p>
      {live && (
        <Buttons>
          <Button size="small" look="primary" onClick={() => act("confirm_review")}>Looks right</Button>
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
          <Button size="small" look="primary" onClick={() => act("start_yes")}>Yes, start</Button>
          <Button size="small" look="faint" onClick={() => act("start_not_yet")}>Not yet</Button>
          <Button size="small" look="primary" soft onClick={() => act("start_talk")}>Talk to someone</Button>
        </Buttons>
      )}
    </Shell>
  );
}

function ReceiptCard({ caseId, respondBy }: { caseId: string; respondBy: string }) {
  return (
    <Shell title="Request received">
      <p>
        Case <span className="font-bold">{caseId}</span>
      </p>
      <p className="mt-1 font-bold text-[#1f1c4f]">We&apos;ll respond by {shortDate(respondBy, true)}.</p>
      <ol className="mt-2 space-y-0.5 text-[12px]">
        <li>● Received today</li>
        <li className="text-[#a0a5a8]">○ A Westpac person reviews it</li>
        <li className="text-[#a0a5a8]">○ Decision explained to you</li>
      </ol>
      <p className="mt-2 text-[11px] text-[#575f65]">Prototype: simulated handover. Nothing is sent to Westpac.</p>
    </Shell>
  );
}

const HandoverCard = () => (
  <div className="rounded-xl border-l-4 border-[#1f1c4f] bg-white p-3 text-[13px] shadow-sm">
    <div className="text-[14px] font-bold text-[#1f1c4f]">Your safety matters most</div>
    <p className="mt-1">
      I&apos;ve stopped the form. Westpac&apos;s Priority Assist team are specialists and will take it from here. You won&apos;t need to explain again.
    </p>
    <p className="mt-1.5 text-[12px]">In danger now? Call 000. 1800RESPECT: 1800 737 732.</p>
    <Buttons>
      <Button size="small" look="faint" tag="a" href="https://www.google.com">Quick exit</Button>
    </Buttons>
  </div>
);

export function ChatCard({ card, act, live }: { card: Card; act: Act; live: boolean }) {
  switch (card.type) {
    case "alert":
      return <AlertCard shortfall={card.shortfall} date={card.date} act={act} live={live} />;
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
    case "handover":
      return <HandoverCard />;
  }
}
