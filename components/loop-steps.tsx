import type { QueueRow, SessionView } from "@/lib/contract";

// The loop the product is named after, and who does each part.
const STEPS = [
  { name: "Notice", who: "Rules" },
  { name: "Explain", who: "AI, from Westpac's pages" },
  { name: "Prepare", who: "AI and the customer" },
  { name: "Decide", who: "A Westpac person" },
  { name: "Check in", who: "Rules" },
];

/** Where this customer is in the loop, worked out from what has happened so far. */
function currentStep(view: SessionView | null, row: QueueRow | undefined): number {
  if (view?.messages.some((m) => m.card?.type === "check_in")) return 4;
  if (row?.case && row.case.draft.fields.length + row.case.summary.length > 0 && view?.messages.some((m) => m.card?.type === "receipt" || m.card?.type === "handover")) return 3;
  if (view && ["prepare", "review", "start_request"].includes(view.phase)) return 2;
  if (view && view.messages.length > 0 && view.phase !== "alert") return 1;
  return 0;
}

export function LoopSteps({ view, row }: { view: SessionView | null; row: QueueRow | undefined }) {
  const current = currentStep(view, row);
  return (
    <ol
      className="flex items-stretch gap-0 overflow-hidden rounded-lg border border-border-muted-soft bg-background-white text-[12px] shadow-sm"
      aria-label="Where this customer is in the CareLoop"
    >
      {STEPS.map((step, i) => (
        <li
          key={step.name}
          aria-current={i === current ? "step" : undefined}
          className={`relative flex flex-1 items-center gap-2 border-r border-border-muted-soft px-3 py-2 ${
            i === current ? "bg-surface-hero text-text-mono" : i < current ? "bg-surface-hero-faint text-text-hero" : "bg-background-white text-text-muted"
          }`}
        >
          <span
            className={`flex size-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
              i === current ? "bg-surface-primary text-text-mono" : i < current ? "bg-surface-hero text-text-mono" : "border border-border-muted-mild text-text-muted"
            }`}
          >
            {i < current ? "✓" : i + 1}
          </span>
          <span className="min-w-0">
            <span className="block font-bold leading-tight">{step.name}</span>
            <span className="block truncate text-[11px] leading-tight opacity-80">{step.who}</span>
          </span>
          {i === current && <span className="absolute inset-x-0 bottom-0 h-[3px] bg-surface-primary" />}
        </li>
      ))}
      <li className="flex items-center px-3 text-[11px] text-text-muted" aria-hidden>
        ↺ back to 1
      </li>
    </ol>
  );
}
