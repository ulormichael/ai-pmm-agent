import express from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { run, user } from "@openai/agents";
import { describeInterruptions, applyDecisions } from "./approvals.mjs";

const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_SESSIONS = 200;

function tokenOk(given, expected) {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * HTTP API around Becky. Every route except /api/health needs the x-api-key header,
 * because this service can send email.
 */
export function createApp({ becky, guidance, email, audit, token, allowedOrigin }) {
  if (!token) throw new Error("An API token is required.");
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  // Minimal CORS: only the one configured frontend origin.
  app.use((req, res, next) => {
    if (allowedOrigin && req.headers.origin === allowedOrigin) {
      res.set({
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Headers": "content-type, x-api-key",
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        Vary: "Origin",
      });
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.get("/api/health", (_req, res) => res.json({ ok: true, emailMode: email.mode }));

  app.use("/api", (req, res, next) =>
    tokenOk(req.get("x-api-key"), token) ? next() : res.status(401).json({ error: "Unauthorized" }),
  );

  // ---- sessions ----
  const sessions = new Map();
  const getSession = (id) => {
    const s = sessions.get(id);
    if (!s || Date.now() - s.touched > SESSION_TTL_MS) {
      sessions.delete(id);
      return null;
    }
    s.touched = Date.now();
    return s;
  };

  async function toResponse(s, result) {
    if (result.interruptions?.length) {
      s.pending = result;
      return { status: "approval_required", approvals: await describeInterruptions(result, email) };
    }
    s.pending = null;
    s.history = result.history;
    return { status: "done", reply: result.finalOutput ?? "" };
  }

  async function guarded(req, res, fn) {
    const s = getSession(req.params.id);
    if (!s) return res.status(404).json({ error: "Session not found or expired" });
    if (s.busy) return res.status(409).json({ error: "Session is busy" });
    s.busy = true;
    try {
      return await fn(s);
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      console.error("Agent error:", e);
      return res.status(500).json({ error: "Agent run failed" });
    } finally {
      s.busy = false;
    }
  }

  app.post("/api/sessions", (_req, res) => {
    for (const [id, s] of sessions) if (Date.now() - s.touched > SESSION_TTL_MS) sessions.delete(id);
    if (sessions.size >= MAX_SESSIONS) return res.status(429).json({ error: "Too many active sessions" });
    const id = randomUUID();
    sessions.set(id, { history: [], pending: null, busy: false, touched: Date.now() });
    res.status(201).json({ sessionId: id });
  });

  app.post("/api/sessions/:id/messages", (req, res) =>
    guarded(req, res, async (s) => {
      const text = req.body?.text;
      if (typeof text !== "string" || !text.trim() || text.length > 8000)
        return res.status(400).json({ error: "text must be a non-empty string up to 8000 chars" });
      if (s.pending) return res.status(409).json({ error: "Resolve pending approvals first", status: "approval_required" });
      const result = await run(becky, [...s.history, user(text.trim())]);
      res.json(await toResponse(s, result));
    }),
  );

  app.post("/api/sessions/:id/approvals", (req, res) =>
    guarded(req, res, async (s) => {
      if (!s.pending) return res.status(409).json({ error: "Nothing is waiting for approval" });
      const d = req.body?.decisions;
      const valid =
        Array.isArray(d) && d.length > 0 &&
        d.every((x) => x && typeof x.id === "string" && typeof x.approve === "boolean" &&
          (x.message === undefined || (typeof x.message === "string" && x.message.length <= 2000)));
      if (!valid) return res.status(400).json({ error: "decisions must be [{ id, approve, message? }]" });
      const result = await applyDecisions(becky, s.pending, d, audit);
      res.json(await toResponse(s, result));
    }),
  );

  // ---- human guidance ----
  app.get("/api/guidance", (_req, res) => res.json({ rules: guidance.list() }));
  app.post("/api/guidance", async (req, res) => {
    const text = req.body?.text;
    if (typeof text !== "string" || !text.trim() || text.length > 500)
      return res.status(400).json({ error: "text must be a non-empty string up to 500 chars" });
    const id = await guidance.add(text);
    await audit.log("guidance_added", { id, text: text.trim(), via: "api" });
    res.status(201).json({ id });
  });
  app.delete("/api/guidance/:id", async (req, res) => {
    const ok = await guidance.remove(req.params.id);
    if (ok) await audit.log("guidance_removed", { id: Number(req.params.id), via: "api" });
    res.status(ok ? 200 : 404).json({ removed: ok });
  });

  // ---- email (read-only; sending always goes through an approved agent run) ----
  app.get("/api/inbox", async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 25);
      res.json({ emails: await email.listInbox({ limit, unreadOnly: req.query.unread === "true" }) });
    } catch (e) {
      console.error("Inbox error:", e);
      res.status(502).json({ error: "Could not read inbox" });
    }
  });
  app.get("/api/inbox/:id", async (req, res) => {
    try {
      res.json({ email: await email.getMessage(req.params.id) });
    } catch {
      res.status(404).json({ error: "Email not found" });
    }
  });

  // ---- audit ----
  app.get("/api/audit", async (req, res) => {
    const n = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 500);
    res.json({ events: await audit.tail(n) });
  });

  return app;
}
