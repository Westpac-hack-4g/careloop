import { NextResponse } from "next/server";
import { aiMode } from "@/lib/ai/assistant";
import { sendAlert, sendCheckIn } from "@/lib/conversation/engine";
import { isCustomerId } from "@/lib/data";
import { runNightlyReport } from "@/lib/report";
import { getAudit, getReport, resetStore } from "@/lib/store";
import { withVisitor } from "@/lib/visitor";

export const dynamic = "force-dynamic";

/** Presenter bar: which AI mode is running, the audit log and the latest nightly report. */
export const GET = withVisitor(() => NextResponse.json({ aiMode: aiMode(), audit: getAudit().slice(-40), report: getReport() }));

/** Presenter bar controls: { op: "reset" }, { op: "send_alert", customerId }, { op: "check_in", customerId, recovered } or { op: "run_report" }. */
export const POST = withVisitor(async (request) => {
  const body = (await request.json()) as { op?: unknown; customerId?: unknown; recovered?: unknown };
  if (body.op === "reset") {
    resetStore();
    return NextResponse.json({ ok: true });
  }
  if (body.op === "run_report") return NextResponse.json({ report: await runNightlyReport() });
  if (body.op === "send_alert" && isCustomerId(body.customerId)) return NextResponse.json(sendAlert(body.customerId));
  if (body.op === "check_in" && isCustomerId(body.customerId)) return NextResponse.json(sendCheckIn(body.customerId, body.recovered === true));
  return NextResponse.json({ error: "Unknown op" }, { status: 400 });
});
