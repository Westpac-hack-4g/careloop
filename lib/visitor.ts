import { runAsVisitor } from "./store";
import { VISITOR_COOKIE } from "./visitor-cookie";

const COOKIE = new RegExp(`(?:^|;\\s*)${VISITOR_COOKIE}=([A-Za-z0-9-]{8,64})`);

/** Wraps an API route so it works on the caller's own copy of the demo (see lib/store). */
export function withVisitor(handler: (request: Request) => Promise<Response> | Response) {
  return (request: Request): Promise<Response> | Response => {
    const id = COOKIE.exec(request.headers.get("cookie") ?? "")?.[1] ?? "shared";
    return runAsVisitor(id, () => handler(request));
  };
}
