# CareLoop prototype

Hackathon prototype on made-up customers. Not a Westpac product.

One Next.js app: the customer's phone on the left, the Westpac Assist staff console on the right.
The logic is real (consent gate, form filling, case with a 21 day deadline); the data, login, push
notification and handover to Westpac are simulated. Every risk figure (features, warning signals, tier,
the 14-day forecast, the ML score) comes from the Python ML service on the `ml` branch.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # tier engine, consent gate, Sarah's demo path
npm run typecheck
npm run lint
npm run kb         # save Westpac's public support pages again into data/kb
```

### Refresh the ML results

The app reads `data/ml-results.json`. Rebuild it whenever the ML code or its demo customers change.
You need Python 3.12 and a checkout of the `ml` branch (its `ml/` folder) with its virtual environment set up as in `ml/README.md`:

```bash
git worktree add ../careloop-ml origin/ml
```

```bash
../careloop-ml/ml/.venv/Scripts/python.exe scripts/export-ml-results.py --ml-dir ../careloop-ml/ml
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
| `data/ml-results.json` | Tom, Sarah, Mia (plus Alex and Tom's savings control): accounts, pays, repayments, known bills and the ML service's full analysis, as of 16 Nov 2026 | Data scientist |
| `data/kb/` | Westpac's public support pages the assistant answers from (12 pages, saved by `npm run kb`) | AI engineer |
| `lib/tier/` | Turns the ML service's result into the app's shapes: reasons, 14-day projection, timeline. Recomputes nothing. No AI. | Developer |
| `scripts/export-ml-results.py` | Writes `data/ml-results.json` from the ML service | Data scientist |
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

## Demo

The step by step script for the demo is in [docs/demo-scenario.md](docs/demo-scenario.md).

How the three services fit together is in [docs/architecture.md](docs/architecture.md).

## Still to do

- Live AI eval: 24 of 24 prompts passed on 17 Nov 2026 (see [docs/ai-eval.md](docs/ai-eval.md)). Rerun with `npm run eval:ai` after changing the prompt; it calls the paid API.
- Staff case summary is built by code; the plan has the AI write it.
- The four weeks before the check-in are simulated from the presenter bar; there is no real clock or later transaction data.
- Screens are a first pass with GEL buttons only; the designer owns the rest.
