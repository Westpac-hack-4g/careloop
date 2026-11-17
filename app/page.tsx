"use client";

import { useCallback, useEffect, useState } from "react";
import { Guide } from "@/components/guide";
import { LoopSteps } from "@/components/loop-steps";
import { Phone } from "@/components/phone/phone";
import { PresenterBar } from "@/components/presenter-bar";
import { StaffConsole } from "@/components/staff/console";
import { api } from "@/lib/client/api";
import type { AuditEntry, CustomerId, NightlyReport, QueueRow, SessionView } from "@/lib/contract";

// One page, both sides: the customer's phone on the left, the staff console on the right.

const POLL_MS = 1500;

export default function Home() {
  const [customerId, setCustomerId] = useState<CustomerId>("sarah");
  const [view, setView] = useState<SessionView | null>(null);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [selectedCase, setSelectedCase] = useState<CustomerId | null>(null);
  const [demo, setDemo] = useState<{ aiMode: string; audit: AuditEntry[]; report: NightlyReport | null }>({ aiMode: "", audit: [], report: null });
  const [staffTab, setStaffTab] = useState<"queue" | "report">("queue");
  const [reportBusy, setReportBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showPresenter, setShowPresenter] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [session, cases, info] = await Promise.all([api.session(customerId), api.queue(), api.demoInfo()]);
      setView(session);
      setQueue(cases.queue);
      setDemo(info);
    } catch {
      // The next poll tries again.
    }
  }, [customerId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "`" && !typing) setShowPresenter((shown) => !shown);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = async (work: () => Promise<unknown>) => {
    setNotice("");
    try {
      await work();
    } catch {
      setNotice("That didn't go through. Try again.");
    }
    await refresh();
  };

  const sendText = async (text: string) => {
    // Show the customer's message straight away while the reply is on its way.
    setView((v) => v && { ...v, lockScreenBanner: false, messages: [...v.messages, { id: "pending", role: "customer", text, at: "" }] });
    setBusy(true);
    await run(() => api.sendText(customerId, text));
    setBusy(false);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-[1280px] flex-col gap-3 p-4">
      {showPresenter && (
        <PresenterBar
          customerId={customerId}
          alertsOn={view?.alertsOn ?? true}
          aiMode={demo.aiMode}
          notice={notice}
          audit={demo.audit}
          onPick={(id) => {
            setView(null);
            setCustomerId(id);
          }}
          onSendAlert={() =>
            run(async () => {
              const result = await api.sendAlert(customerId);
              if (!result.sent) setNotice(result.reason ?? "No alert sent.");
            })
          }
          onToggleAlerts={() => run(() => api.sendAction(customerId, "toggle_alerts"))}
          onCheckIn={(recovered) =>
            run(async () => {
              const result = await api.checkIn(customerId, recovered);
              if (!result.sent) setNotice(result.reason ?? "No check-in sent.");
            })
          }
          reportBusy={reportBusy}
          onRunReport={async () => {
            // The summaries are written by the AI, so this takes a few seconds.
            setReportBusy(true);
            await run(async () => {
              await api.runReport();
              setStaffTab("report");
            });
            setReportBusy(false);
          }}
          onReset={() =>
            run(async () => {
              await api.reset();
              setSelectedCase(null);
              setStaffTab("queue");
            })
          }
        />
      )}
      {/* Shown with the presenter bar and hidden with it (the backtick key), so it never appears on stage. */}
      {showPresenter && <Guide view={view} row={queue.find((r) => r.customerId === customerId)} report={demo.report} />}
      <LoopSteps view={view} row={queue.find((r) => r.customerId === customerId)} />
      <div className="flex flex-wrap items-start justify-center gap-6">
        <Phone view={view} busy={busy} onText={sendText} onAction={(action) => run(() => api.sendAction(customerId, action))} />
        <StaffConsole queue={queue} report={demo.report} tab={staffTab} onTab={setStaffTab} selected={selectedCase ?? customerId} onSelect={setSelectedCase} onReply={(id, text) => run(() => api.staffReply(id, text))} onStartReview={(id) => run(() => api.startReview(id))} onDecide={(id, outcome) => run(() => api.decide(id, outcome))} />
      </div>
      <p className="text-center text-[11px] text-text-muted">Hackathon prototype on made-up customers. Not a Westpac product.</p>
    </main>
  );
}
