import { NextResponse } from "next/server";
import { aiMode } from "@/lib/ai/assistant";
import { sendAlert, sendCheckIn } from "@/lib/conversation/engine";
import { isCustomerId } from "@/lib/data";
import { getAudit, resetStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Presenter bar: which AI mode is running, and the audit log. */
export async function GET() {
  return NextResponse.json({ aiMode: aiMode(), audit: getAudit().slice(-40) });
}

/** Presenter bar controls: { op: "reset" }, { op: "send_alert", customerId } or { op: "check_in", customerId, recovered }. */
export async function POST(request: Request) {
  const body = (await request.json()) as { op?: unknown; customerId?: unknown; recovered?: unknown };
  if (body.op === "reset") {
    resetStore();
    return NextResponse.json({ ok: true });
  }
  if (body.op === "send_alert" && isCustomerId(body.customerId)) return NextResponse.json(sendAlert(body.customerId));
  if (body.op === "check_in" && isCustomerId(body.customerId)) return NextResponse.json(sendCheckIn(body.customerId, body.recovered === true));
  return NextResponse.json({ error: "Unknown op" }, { status: 400 });
}
