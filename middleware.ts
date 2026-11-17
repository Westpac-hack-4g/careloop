import { NextResponse, type NextRequest } from "next/server";
import { VISITOR_COOKIE } from "./lib/visitor-cookie";

/** Gives each browser a random id on its first visit, so every visitor gets their own copy of the demo. */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  if (!request.cookies.get(VISITOR_COOKIE)) {
    response.cookies.set(VISITOR_COOKIE, crypto.randomUUID(), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
  }
  return response;
}

export const config = { matcher: ["/"] };
