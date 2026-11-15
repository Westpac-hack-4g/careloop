import { NextResponse } from "next/server";
import { getQueue, staffReply, startReview } from "@/lib/conversation/engine";
import { isCustomerId } from "@/lib/data";

export const dynamic = "force-dynamic";

/** The staff console polls this for the queue. */
export async function GET() {
  return NextResponse.json({ queue: getQueue() });
}

/** A staff member replies in the customer's chat, or picks up a new request. */
export async function POST(request: Request) {
  const body = (await request.json()) as { customerId?: unknown; text?: unknown; op?: unknown };
  if (isCustomerId(body.customerId) && body.op === "start_review") {
    startReview(body.customerId);
    return NextResponse.json({ queue: getQueue() });
  }
  if (!isCustomerId(body.customerId) || typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json({ error: "Send customerId and text" }, { status: 400 });
  }
  staffReply(body.customerId, body.text.trim().slice(0, 2000));
  return NextResponse.json({ queue: getQueue() });
}
