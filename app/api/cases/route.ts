import { NextResponse } from "next/server";
import { getQueue, recordDecision, staffReply, startReview } from "@/lib/conversation/engine";
import { isCustomerId } from "@/lib/data";
import { isDecisionKey } from "@/lib/decisions";
import { withVisitor } from "@/lib/visitor";

export const dynamic = "force-dynamic";

/** The staff console polls this for the queue. */
export const GET = withVisitor(() => NextResponse.json({ queue: getQueue() }));

/** A staff member replies in the customer's chat, or picks up a new request. */
export const POST = withVisitor(async (request) => {
  const body = (await request.json()) as { customerId?: unknown; text?: unknown; op?: unknown; outcome?: unknown };
  if (isCustomerId(body.customerId) && body.op === "decide" && isDecisionKey(body.outcome)) {
    recordDecision(body.customerId, body.outcome);
    return NextResponse.json({ queue: getQueue() });
  }
  if (isCustomerId(body.customerId) && body.op === "start_review") {
    startReview(body.customerId);
    return NextResponse.json({ queue: getQueue() });
  }
  if (!isCustomerId(body.customerId) || typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json({ error: "Send customerId and text" }, { status: 400 });
  }
  staffReply(body.customerId, body.text.trim().slice(0, 2000));
  return NextResponse.json({ queue: getQueue() });
});
