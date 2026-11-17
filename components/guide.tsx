import type { NightlyReport, QueueRow, SessionView } from "@/lib/contract";

// A one-line "what to do next" for someone opening the demo for the first time.
// It only reads what is already on screen; it changes nothing.

const QUESTION = "Will asking for help hurt my credit score?";
const STORY = "My shifts went from five to three days in October, probably until February. I also have a car loan, $320 a month.";

/** The next thing to try, or null when there is nothing to suggest. `say` is a line the visitor can type. */
function nextStep(view: SessionView | null, row: QueueRow | undefined, report: NightlyReport | null): { text: string; say?: string } | null {
  if (!view) return null;
  if (view.lockScreenBanner) return { text: "Tap the message on the phone's lock screen." };
  if (!view.messages.length) return { text: "Start here: press Send the heads-up in the bar above." };
  switch (view.phase) {
    case "alert":
    case "explain":
      return { text: "Tap a button on the heads-up card. Or type a worry first, for example:", say: QUESTION };
    case "consent":
      return { text: "Tap Allow, so CareLoop may look at the last 90 days of transactions. Before that, the AI cannot read them." };
    case "projection":
      return { text: "Read the forecast, then tap Fill in a request with me." };
    case "prepare":
      return { text: "Say what changed in your own words, then answer what CareLoop asks. For example:", say: STORY };
    case "review":
      return { text: "Check the request, then tap Looks right. To change a field, just type the correction." };
    case "start_request":
      return { text: "Tap Yes, start to send the request to the Assist team." };
    case "check_in":
      return { text: "Tap an answer on the check-in card, for example Go back to normal." };
    case "handover":
      return { text: "The chat is now with a person. Reply from the staff console on the right, or press Reset." };
    default:
      break;
  }
  if (row?.case?.status === "new") return { text: "Now the staff side: in the console on the right, press Start review." };
  if (row?.case?.status === "in_review" && row.case.draft.fields.length) return { text: "In the staff console, choose a decision and press Record decision. A person decides, never CareLoop." };
  if (row?.case?.status === "arrangement" && !view.messages.some((m) => m.card?.type === "check_in")) {
    return { text: "Four weeks pass: in the bar above, under +4 weeks, press Pay recovered." };
  }
  if (!report && view.messages.some((m) => m.card?.type === "receipt" || m.card?.type === "callback")) {
    return { text: "Last step: press Run nightly report in the bar above. It takes a few seconds." };
  }
  if (report) return { text: "That is the whole loop. Press Reset to start again, or pick Tom or Mia in the bar above to see the other tiers." };
  return null;
}

export function Guide({ view, row, report }: { view: SessionView | null; row: QueueRow | undefined; report: NightlyReport | null }) {
  const step = nextStep(view, row, report);
  if (!step) return null;
  return (
    <div className="flex items-baseline gap-2 rounded-lg border border-border-info-mild bg-surface-info-faint px-3 py-1.5 text-[13px] text-text-body" role="status">
      <span className="shrink-0 text-[11px] font-bold uppercase text-text-info">Next</span>
      <span>
        {step.text}
        {step.say && <span className="ml-1 font-medium italic">&ldquo;{step.say}&rdquo;</span>}
      </span>
    </div>
  );
}
