# Becky: AI Product Marketing Assistant

Node.js agent built on the OpenAI Agents SDK. Becky helps with positioning, messaging, personas, GTM, launch campaigns and sales enablement, can read and send email, and is steered by a human at every step that matters.

## Setup
```bash
npm install
cp .env.example .env      # add OPENAI_API_KEY
npm start                 # terminal chat, or: node index.mjs "Create a launch outline for Scoutflair"
npm run serve             # HTTP API for the frontend (see below)
npm test                  # 13 offline tests, no API key needed
```
Never commit `.env` or put the key in frontend code.

## Human control
| What | How |
|---|---|
| Approve every outgoing email | Automatic. `send_email` and `reply_to_email` pause for y/n |
| Reject and redirect | At the approval prompt, type guidance (e.g. "shorter, less formal"). Becky revises and asks again |
| Standing rules | `/guide <text>`, `/guides`, `/unguide <id>`. Saved in `data/guidance.json`, applied on the next turn |
| Audit trail | `data/audit.jsonl` logs approvals, rejections, sent/blocked emails and guidance changes |
| Hard limits | `EMAIL_ALLOWED_RECIPIENTS` (enforced even after approval) and `EMAIL_MAX_PER_SESSION` |

Inbound email is treated as untrusted data: Becky is instructed never to follow instructions found inside an email, and nothing leaves without your approval anyway.

## Email
Leave SMTP/IMAP blank and Becky runs in **mock mode**: the inbox comes from `data/mock-inbox.json` and "sent" mail is written to `data/outbox/`. Fill in all SMTP and IMAP values in `.env` for live mode. Use an app password, not your main password, and check your provider's current SMTP/IMAP settings.

## Layout
```
index.mjs              entry point
src/cli.mjs            terminal chat, commands, approval prompts
server.mjs             starts the HTTP API
src/app.mjs            Express routes (sessions, approvals, guidance, inbox, audit)
src/runtime.mjs        shared wiring used by CLI and API
src/agents/becky.mjs   Becky's instructions + guidance injection
src/tools/index.mjs    conversion rate, inbox, read, send, reply
src/approvals.mjs      human-in-the-loop resolve loop
src/email/             mock + live (SMTP/IMAP) providers
src/guidance.mjs       persistent standing guidance
src/audit.mjs          JSONL audit log
examples/              your original Slack posting script (needs @slack/web-api)
```
`createBecky()` and `resolveApprovals()` are UI-agnostic, so an Express API and the React frontend can reuse them later.

## HTTP API (for the React frontend)
Set `BECKY_API_TOKEN` and `ALLOWED_ORIGIN` (your React dev server) in `.env`, then `npm run serve`. It binds to `127.0.0.1:3001` by default. Every route except `/api/health` needs an `x-api-key` header. Keep that token on a server or proxy you control; do not ship it in public browser code.

| Method + path | Purpose |
|---|---|
| `POST /api/sessions` | start a conversation, returns `{ sessionId }` |
| `POST /api/sessions/:id/messages` `{ text }` | talk to Becky |
| `POST /api/sessions/:id/approvals` `{ decisions: [{ id, approve, message? }] }` | answer pending approvals |
| `GET/POST /api/guidance`, `DELETE /api/guidance/:id` | standing human guidance |
| `GET /api/inbox?unread=true&limit=10`, `GET /api/inbox/:id` | read-only inbox view |
| `GET /api/audit?limit=50` | recent audit events |

Both message and approval calls return either `{ "status": "done", "reply": "..." }` or `{ "status": "approval_required", "approvals": [{ "id", "tool", "args", "context", "emailMode" }] }`. When approval is required, show the draft, then post a decision. A rejection with `message` is your guidance to Becky: she revises and the response comes back as another `approval_required`. Sending is never possible through the API without an approval decision.

```bash
curl -X POST localhost:3001/api/sessions -H "x-api-key: $T"
curl -X POST localhost:3001/api/sessions/$ID/messages -H "x-api-key: $T" -H "content-type: application/json" \
     -d '{"text":"Reply to email m1 with a short demo offer"}'
curl -X POST localhost:3001/api/sessions/$ID/approvals -H "x-api-key: $T" -H "content-type: application/json" \
     -d '{"decisions":[{"id":"<approvals[0].id>","approve":false,"message":"Make it friendlier"}]}'
```
Sessions live in memory (1 hour idle expiry), so restarting the server clears them. Guidance and the audit log persist on disk.
