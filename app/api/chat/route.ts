import { NextResponse } from "next/server";
import { getSessionView, handleAction, handleMessage, type Action } from "@/lib/conversation/engine";
import { isCustomerId } from "@/lib/data";
import { withVisitor } from "@/lib/visitor";

export const dynamic = "force-dynamic";

/** The phone polls this for the chat. */
export const GET = withVisitor(async (request) => {
  const customerId = new URL(request.url).searchParams.get("customerId");
  if (!isCustomerId(customerId)) return NextResponse.json({ error: "Unknown customer" }, { status: 400 });
  return NextResponse.json(getSessionView(customerId));
});

/** One customer turn: free text ({ text }) or a button tap ({ action }). */
export const POST = withVisitor(async (request) => {
  const body = (await request.json()) as { customerId?: unknown; text?: unknown; action?: unknown };
  if (!isCustomerId(body.customerId)) return NextResponse.json({ error: "Unknown customer" }, { status: 400 });
  if (typeof body.action === "string") handleAction(body.customerId, body.action as Action);
  else if (typeof body.text === "string" && body.text.trim()) await handleMessage(body.customerId, body.text.trim().slice(0, 2000));
  else return NextResponse.json({ error: "Send text or an action" }, { status: 400 });
  return NextResponse.json(getSessionView(body.customerId));
});
