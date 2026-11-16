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
    <ol className="flex items-stretch gap-1 text-[12px]" aria-label="Where this customer is in the CareLoop">
      {STEPS.map((step, i) => (
        <li
          key={step.name}
          aria-current={i === current ? "step" : undefined}
          className={`flex-1 rounded-md border px-3 py-1.5 ${
            i === current ? "border-[#1f1c4f] bg-[#1f1c4f] text-white" : i < current ? "border-[#c9cdd1] bg-[#eef0f4] text-[#1f1c4f]" : "border-[#e3e5e8] bg-white text-[#8b9094]"
          }`}
        >
          <div className="font-bold">
            {i + 1}. {step.name}
          </div>
          <div className="text-[11px] opacity-80">{step.who}</div>
        </li>
      ))}
      <li className="flex items-center px-1 text-[11px] text-[#575f65]" aria-hidden>
        ↺ back to 1
      </li>
    </ol>
  );
}
