"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Phase, SessionView } from "@/lib/contract";
import { Button } from "@westpac/ui/button";
import { Input } from "@westpac/ui/input";
import { WBCLogo } from "@westpac/ui/symbol";
import { money } from "@/lib/client/api";
import { ChatCard } from "./cards";

// Which card is waiting for a tap at each step. Older cards lose their buttons.
const LIVE_CARD: Partial<Record<Phase, string>> = {
  alert: "alert",
  consent: "consent",
  projection: "projection",
  review: "review",
  start_request: "start_request",
  check_in: "check_in",
};

function Bubble({ message }: { message: ChatMessage }) {
  if (!message.text) return null;
  const mine = message.role === "customer";
  // Turn [1] markers into chips that open the Westpac page.
  const parts = message.text.split(/(\[\d+\])/g);
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] px-3 py-2 text-[13px] leading-snug ${
          mine
            ? "rounded-2xl rounded-br-sm bg-surface-hero text-text-mono"
            : message.role === "staff"
              ? "rounded-2xl rounded-bl-sm border border-border-hero bg-surface-hero-faint text-text-body"
              : "rounded-2xl rounded-bl-sm border border-border-muted-soft bg-background-white text-text-body shadow-sm"
        }`}
      >
        {message.role === "staff" && <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-text-hero">Westpac Assist team</div>}
        {parts.map((part, i) => {
          const n = Number(part.match(/^\[(\d+)\]$/)?.[1]);
          const citation = message.citations?.find((c) => c.n === n);
          return citation ? (
            <a key={i} href={citation.url} target="_blank" rel="noreferrer" title={citation.title} className={`mx-0.5 rounded-sm px-1 text-[11px] font-bold underline ${mine ? "bg-background-white text-text-hero" : "bg-surface-primary-faint text-text-link"}`}>
              {n}
            </a>
          ) : (
            <span key={i}>{part}</span>
          );
        })}
        {message.citations?.map((c) => (
          <div key={c.n} className={`mt-1 text-[11px] ${mine ? "text-text-mono opacity-80" : "text-text-muted"}`}>
            [{c.n}] {c.title}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The signed-in app's home screen. The heads-up shows on the loan tile; the lock screen never mentions money. */
function Home({ view, onOpenChat }: { view: SessionView; onOpenChat: () => void }) {
  const firstName = view.customerName.split(" ")[0];
  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-3">
      <p className="px-1 pt-1 text-[15px] font-bold text-text-heading">Hi {firstName}</p>
      <div className="rounded-xl border border-border-muted-soft bg-background-white p-3 text-text-body shadow-sm">
        <div className="text-[11px] text-text-muted">Everyday account</div>
        <div className="text-[20px] font-bold text-text-heading">{money(view.home.balance)}</div>
      </div>
      {view.home.tiles.map((tile, i) => {
        // The heads-up sits on the first product: the loan the repayment belongs to.
        const flagged = view.home.headsUp && i === 0;
        return (
          <div key={tile.name} className={`rounded-xl border border-border-muted-soft bg-background-white p-3 text-text-body shadow-sm ${flagged ? "ring-2 ring-border-primary" : ""}`}>
            <div className="text-[11px] text-text-muted">{tile.name}</div>
            <div className="text-[13px] font-medium">{tile.detail}</div>
            {flagged ? (
              <button onClick={onOpenChat} className="mt-2 flex w-full items-center justify-between rounded-lg bg-surface-primary-faint px-3 py-2 text-left text-[13px] font-bold text-text-primary">
                <span>Heads up about your next repayment</span>
                <span aria-hidden>›</span>
              </button>
            ) : (
              i === 0 && (
                <button onClick={onOpenChat} className="mt-1.5 text-[12px] font-bold text-text-heading underline">
                  Need help with repayments?
                </button>
              )
            )}
          </div>
        );
      })}
      <button onClick={onOpenChat} className="w-full rounded-xl border border-border-muted-soft bg-background-white p-3 text-left text-[13px] shadow-sm">
        <span className="font-bold text-text-heading">Messages</span>
        <span className="block text-[12px] text-text-muted">{view.messages.length ? "Continue your chat with CareLoop" : "Ask CareLoop about repayments and support"}</span>
      </button>
    </div>
  );
}

export function Phone({
  view,
  busy,
  onText,
  onAction,
}: {
  view: SessionView | null;
  busy: boolean;
  onText: (text: string) => void;
  onAction: (action: string) => void;
}) {
  const [text, setText] = useState("");
  const [screen, setScreen] = useState<"home" | "chat">("home");
  const scroller = useRef<HTMLDivElement>(null);
  const count = view?.messages.length ?? 0;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [count, busy]);

  // A fresh customer or a reset starts on the home screen.
  const customerId = view?.customerId;
  useEffect(() => {
    if (count === 0) setScreen("home");
  }, [customerId, count]);

  const lastOfType = (type: string) => view?.messages.filter((m) => m.card?.type === type).at(-1)?.id;

  return (
    <div className="relative flex h-[760px] w-[390px] shrink-0 flex-col overflow-hidden rounded-[36px] border-[10px] border-[#1c1c1e] bg-background-pale shadow-xl">
      <header className="flex items-center justify-between border-b-4 border-border-primary bg-background-white px-4 py-2.5">
        <span className="flex items-center gap-2">
          {screen === "chat" && (
            <button onClick={() => setScreen("home")} aria-label="Back to home" className="text-[20px] leading-none text-text-hero">
              ‹
            </button>
          )}
          <WBCLogo className="h-[22px] w-[54px]" aria-label="Westpac" />
          {screen === "chat" && <span className="text-[13px] font-bold text-text-hero">CareLoop</span>}
        </span>
        <span className="text-[12px] text-text-muted">{view?.customerName ?? ""}</span>
      </header>

      {view?.lockScreenBanner && (
        // The lock screen never mentions money.
        <button
          onClick={() => {
            // A heads-up opens the home screen, where it sits on the loan tile. Anything else opens the chat.
            setScreen(view.home.headsUp ? "home" : "chat");
            onAction("open_app");
          }}
          className="absolute inset-x-3 top-14 z-10 rounded-2xl border border-border-muted-soft bg-background-white p-3 text-left shadow-lg"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-text-muted">
            <WBCLogo className="h-[12px] w-[30px]" aria-hidden /> Westpac · now
          </div>
          <div className="text-[13px] text-text-body">You have a new message in the Westpac app.</div>
        </button>
      )}

      {view && screen === "home" ? (
        <Home view={view} onOpenChat={() => setScreen("chat")} />
      ) : (
        <>
      <div ref={scroller} className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {count === 0 && <p className="pt-24 text-center text-[13px] text-text-muted">Ask CareLoop anything about repayments, or wait for a heads-up.</p>}
        {view?.messages.map((m) =>
          m.card ? (
            <ChatCard key={m.id} card={m.card} act={onAction} live={LIVE_CARD[view.phase] === m.card.type && lastOfType(m.card.type) === m.id} />
          ) : (
            <Bubble key={m.id} message={m} />
          ),
        )}
        {busy && <div className="text-[12px] italic text-text-muted">CareLoop is typing…</div>}
      </div>

      <form
        className="flex gap-2 border-t border-border-muted-soft bg-background-white p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim() || busy) return;
          onText(text.trim());
          setText("");
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message"
          aria-label="Message to CareLoop"
          className="min-w-0 flex-1 !text-[13px]"
        />
        <Button className="!text-[13px] font-medium" type="submit" disabled={busy} look="primary">
          Send
        </Button>
      </form>
        </>
      )}
    </div>
  );
}
