# Hosting CareLoop

As of 17 Nov 2026.

## Summary

CareLoop runs as one ordinary Node server (`npm run build`, then `npm start`). It needs a host that keeps a single server running, such as Railway, Render or a plain virtual machine. It does not work on serverless hosts (Vercel, Cloudflare Workers, AWS Lambda or Amplify), because the demo's state lives in the server's memory and those hosts spread requests over short-lived copies.

## What a host needs

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Start command | `npm start` (listens on the `PORT` the host sets) |
| Node version | 20 or newer (set in `package.json`) |
| Instances | Exactly one. Two instances would each hold different chats. |
| Python | Not needed. The app reads the ML results saved in `data/`. |

## Variables

Set these on the host, never in the repository.

| Name | Needed | What it does |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | For live AI replies | Without it the app runs in sample mode with scripted replies. |
| `CARELOOP_AI_LIMIT` | Optional, default 40 | AI replies one visitor may use. After that their replies are scripted. A full run of the script uses about 5. |
| `CARELOOP_AI_TOTAL_LIMIT` | Optional, default 1500 | AI replies for all visitors together since the server last started. |
| `CARELOOP_MODEL`, `CARELOOP_TODAY`, `CARELOOP_AI` | Optional | Same as in `.env.example`. |

Also set a monthly spend limit for the key in the Anthropic Console. The two limits above reset when the server restarts; the Console limit does not.

## What visitors get

- **Their own demo.** Each browser gets a random id in a cookie (`careloop_visitor`) on its first visit, and the server keeps a separate copy of the chats, cases, audit log and report for it. Two people never see or reset each other's run. The cookie holds nothing else.
- **A next-step line.** Under the presenter bar, a line says what to try next. The backtick key hides it together with the presenter bar.
- **No search listing.** The page asks search engines not to index it.

## Limits to know

- State is in memory. A restart or a new deploy clears every visitor's run.
- The server keeps at most 300 visitors' runs and drops ones idle for six hours.
- The page is public to anyone with the address. It carries Westpac branding and text saved from Westpac's public pages, as a student prototype on made-up customers. Share the address only with the people who need it.
