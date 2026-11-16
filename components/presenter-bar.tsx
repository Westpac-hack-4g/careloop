"use client";

import { Fragment } from "react";
import type { AuditEntry, CustomerId } from "@/lib/contract";

const CUSTOMERS: { id: CustomerId; label: string }[] = [
  { id: "tom", label: "Tom (tier 1)" },
  { id: "sarah", label: "Sarah (tier 2)" },
  { id: "mia", label: "Mia (tier 3)" },
];

// Every control is a full-height cell, like the loop steps below.
// Each group is its own white segment with a gap between; cells inside a group get short dividers.
const CELL = "relative flex h-full cursor-pointer items-center whitespace-nowrap px-2.5 text-[12px] transition-colors";
const IDLE = `${CELL} text-text-hero hover:bg-surface-hero-faint`;

/** A short divider between cells of the same group. */
const Tick = () => <span className="my-3 -mx-px w-px shrink-0 bg-border-muted-soft" aria-hidden />;

/** One group: its own white segment, an optional grey label cell, then its cells. */
const Group = ({ label, children, className = "" }: { label?: string; children: React.ReactNode[]; className?: string }) => (
  <div className={`flex h-full items-stretch overflow-visible rounded-lg border border-border-muted-soft bg-background-white shadow-sm [&>:first-child]:rounded-l-lg [&>:last-child]:rounded-r-lg ${className}`}>
    {label && (
      <span className="flex items-center whitespace-nowrap border-r border-border-muted-soft bg-background-faint px-2 text-[10px] font-bold uppercase text-text-muted">
        {label}
      </span>
    )}
    {children.map((child, i) => (
      <Fragment key={i}>
        {i > 0 && <Tick />}
        {child}
      </Fragment>
    ))}
  </div>
);

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
  onCheckIn,
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
  onCheckIn: (recovered: boolean) => void;
  onReset: () => void;
}) {
  return (
    <div className="text-text-body">
      <div className="flex h-[40px] items-stretch gap-2">
        {/* Label segment, same navy as the current loop step. */}
        <div className="flex items-center rounded-lg bg-surface-hero px-3 text-[12px] font-bold text-text-mono shadow-sm" title="Press ` to hide">
          Presenter
        </div>

        <Group>
          {CUSTOMERS.map((c) => (
            <button
              key={c.id}
              onClick={() => onPick(c.id)}
              className={c.id === customerId ? `${CELL} bg-surface-hero-faint font-bold text-text-hero` : IDLE}
            >
              {c.label}
              {c.id === customerId && <span className="absolute inset-x-0 bottom-0 h-[3px] bg-surface-primary" />}
            </button>
          ))}
        </Group>

        <Group label="Today">
          <button onClick={onSendAlert} className={`${CELL} font-bold text-text-primary hover:bg-surface-primary-faint`}>
            Send the heads-up
          </button>
          <button onClick={onToggleAlerts} className={IDLE}>
            Alerts: {alertsOn ? "on" : "off"}
          </button>
        </Group>

        <Group label="+4 weeks">
          <button onClick={() => onCheckIn(true)} className={IDLE}>
            Pay recovered
          </button>
          <button onClick={() => onCheckIn(false)} className={IDLE}>
            Still tight
          </button>
        </Group>

        <Group className="ml-auto">
          <span className="flex items-center gap-1.5 whitespace-nowrap px-2.5 text-[11px] text-text-muted">
            <span className={`size-2 rounded-full ${aiMode === "claude" ? "bg-surface-success" : "bg-surface-muted-mild"}`} aria-hidden />
            {aiMode === "claude" ? "Claude (live)" : "Sample mode"}
          </span>
          {/* Audit log opens as a dropdown so it takes no row of its own. */}
          <details className="relative">
            <summary className={`${IDLE} list-none text-text-muted`}>Log ({audit.length}) ▾</summary>
            <ul className="absolute right-0 top-full z-30 mt-1 max-h-60 w-[520px] overflow-y-auto rounded-lg border border-border-muted-soft bg-background-white p-2 font-mono text-[11px] text-text-muted shadow-lg">
              {audit.length === 0 && <li>Nothing yet.</li>}
              {audit.slice().reverse().map((a, i) => (
                <li key={i}>
                  {a.at.slice(11, 19)} {a.customerId} [{a.kind}] {a.detail}
                </li>
              ))}
            </ul>
          </details>
          <button onClick={onReset} className={`${IDLE} text-text-muted`}>
            Reset
          </button>
        </Group>
      </div>
      {notice && <div className="mt-1.5 rounded-lg border border-border-danger-mild bg-surface-danger-faint px-3 py-1 text-[12px] text-text-danger">{notice}</div>}
    </div>
  );
}
