# CareLoop prototype

Hackathon prototype on made-up customers. Not a Westpac product.

One Next.js app: the customer's phone on the left, the Westpac Assist staff console on the right.
The logic is real (tier rules, consent gate, form filling, case with a 21 day deadline); the data,
login, push notification and handover to Westpac are simulated.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # tier engine, consent gate, Sarah's demo path
npm run typecheck
npm run lint
npm run data       # rebuild data/transactions.csv
npm run kb         # save Westpac's public support pages again into data/kb
```

No API key: the app runs in **sample mode** with a scripted assistant, so the whole demo path works offline.
With `ANTHROPIC_API_KEY` in `.env.local` (see `.env.example`) the assistant is Claude with tool calling,
and the scripted assistant becomes the fallback if the AI is slow or fails.

The presenter bar at the top picks the customer, sends the heads-up, turns alerts off and resets.
Press the backtick key to hide it on stage.

## Where things are

| Folder | What it holds | Owner |
|---|---|---|
| `lib/contract.ts` | The shared data shapes. Change this first. | Everyone |
| `data/` | Tom, Sarah, Mia: customers, schedule, 90 days of transactions | Developer |
| `data/kb/` | Westpac's public support pages the assistant answers from (13 pages, saved by `npm run kb`) | AI engineer |
| `lib/tier/` | Signals, 30 day projection, tier rules, thresholds. No AI. | Developer |
| `lib/conversation/` | Steps, button taps, tools the AI may use per step, consent gate, form | Developer |
| `lib/ai/` | System prompt, Claude loop, reply safety checks, scripted fallback | AI engineer |
| `lib/rag/` | Keyword search (BM25) over `data/kb` | AI engineer |
| `lib/store/` | In-memory sessions, cases, audit log | Developer |
| `components/phone/` | Phone frame and one component per card | Designer |
| `components/staff/` | Queue and case summary | Designer |
| `app/api/` | `chat` (customer turn), `cases` (staff queue), `demo` (presenter bar) | Developer |

## Rules the code enforces

- The AI never calculates. Every dollar amount comes from `lib/tier` and replies with any other amount are blocked.
- Data tools are refused until the customer taps Allow.
- The AI cannot file a request. Only the customer's "Yes, start" tap creates a case.
- A sensitive disclosure stops the form and shows the handover card.
- Every message, tool call and consent change is written to the audit log.

## Still to do

- Run the live AI once with a key in `.env.local` (only sample mode has been run so far) and tune `lib/ai/prompt.ts`.
- Test the live Claude path and run the 24 test prompts from the build plan.
- Staff case summary is built by code; the plan has the AI write it.
- Staff cannot record a decision yet. Ask for info and Book a call draft a reply; Start review tells the customer a person has picked it up.
- Screens are a first pass with GEL buttons only; the designer owns the rest.
