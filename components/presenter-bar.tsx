"use client";

import type { AuditEntry, CustomerId } from "@/lib/contract";

const CUSTOMERS: { id: CustomerId; label: string }[] = [
  { id: "tom", label: "Tom (tier 1)" },
  { id: "sarah", label: "Sarah (tier 2)" },
  { id: "mia", label: "Mia (tier 3)" },
];

/** Hidden on stage. Toggle with the backtick key (`). */
export function PresenterBar({
  customerId,
  alertsOn,
  aiMode,
  notice,
  audit,
  onPick,
  onSendAlert,
  onToggleAlerts,
  onReset,
}: {
  customerId: CustomerId;
  alertsOn: boolean;
  aiMode: string;
  notice: string;
  audit: AuditEntry[];
  onPick: (id: CustomerId) => void;
  onSendAlert: () => void;
  onToggleAlerts: () => void;
  onReset: () => void;
}) {
  const button = "rounded border border-dashed border-[#8b9094] px-2.5 py-1 hover:bg-white";
  return (
    <div className="rounded-lg border border-dashed border-[#8b9094] bg-[#e9eaec] p-2.5 text-[12px] text-[#3a3f43]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">Presenter</span>
        {CUSTOMERS.map((c) => (
          <button key={c.id} onClick={() => onPick(c.id)} className={`${button} ${c.id === customerId ? "bg-white font-bold" : ""}`}>
            {c.label}
          </button>
        ))}
        <button onClick={onSendAlert} className={button}>Send the heads-up</button>
        <button onClick={onToggleAlerts} className={button}>Alerts: {alertsOn ? "on" : "off"}</button>
        <button onClick={onReset} className={button}>Reset</button>
        <span className="ml-auto">AI: {aiMode === "claude" ? "Claude (live)" : "sample mode (scripted, no key)"}</span>
      </div>
      {notice && <div className="mt-1.5 text-[#99000d]">{notice}</div>}
      <details className="mt-1.5">
        <summary className="cursor-pointer">Audit log ({audit.length})</summary>
        <ul className="mt-1 max-h-40 overflow-y-auto font-mono text-[11px]">
          {audit.slice().reverse().map((a, i) => (
            <li key={i}>
              {a.at.slice(11, 19)} {a.customerId} [{a.kind}] {a.detail}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
