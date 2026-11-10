import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTracingDisabled } from "@openai/agents";
import { loadConfig } from "../src/config.mjs";
import { createRuntime } from "../src/runtime.mjs";
import { createApp } from "../src/app.mjs";
import { stubModel } from "../testing/stubModel.mjs";

setTracingDisabled(true);
const TOKEN = "test-token-123";
let server, base, dir;

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "becky-api-"));
  await cp(new URL("../data/mock-inbox.json", import.meta.url), path.join(dir, "mock-inbox.json"));
  const rt = await createRuntime(loadConfig({ BECKY_DATA_DIR: dir }), {
    model: stubModel([
      { call: "send_email", args: { to: ["scout@example.com"], cc: null, subject: "Demo", body: "v1 long draft" } },
      { call: "send_email", args: { to: ["scout@example.com"], cc: null, subject: "Demo", body: "v2 short" } },
      { text: "Sent v2." },
    ]),
  });
  const app = createApp({ ...rt, token: TOKEN, allowedOrigin: "http://localhost:5173" });
  await new Promise((r) => (server = app.listen(0, "127.0.0.1", r)));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = (p, { method = "GET", body, key = TOKEN } = {}) =>
  fetch(base + p, {
    method,
    headers: { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

test("health is open; everything else needs the token", async () => {
  assert.equal((await call("/api/health", { key: null })).status, 200);
  assert.equal((await call("/api/guidance", { key: null })).status, 401);
  assert.equal((await call("/api/guidance", { key: "wrong" })).status, 401);
});

test("CORS only for the configured origin", async () => {
  const ok = await fetch(base + "/api/health", { headers: { origin: "http://localhost:5173" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "http://localhost:5173");
  const bad = await fetch(base + "/api/health", { headers: { origin: "http://evil.example" } });
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
});

test("full flow: message -> approval_required -> reject with guidance -> revised -> approve -> sent", async () => {
  const { sessionId } = await (await call("/api/sessions", { method: "POST" })).json();

  let r = await (await call(`/api/sessions/${sessionId}/messages`, { method: "POST", body: { text: "email the scout" } })).json();
  assert.equal(r.status, "approval_required");
  assert.equal(r.approvals[0].tool, "send_email");
  assert.equal(r.approvals[0].args.body, "v1 long draft");
  assert.equal(await readdir(dir).then((f) => f.includes("outbox")), false, "nothing sent yet");

  // can't chat while an approval is pending
  const blocked = await call(`/api/sessions/${sessionId}/messages`, { method: "POST", body: { text: "hi" } });
  assert.equal(blocked.status, 409);

  // incomplete / malformed decisions are rejected
  assert.equal((await call(`/api/sessions/${sessionId}/approvals`, { method: "POST", body: { decisions: [] } })).status, 400);
  assert.equal(
    (await call(`/api/sessions/${sessionId}/approvals`, { method: "POST", body: { decisions: [{ id: "nope", approve: true }] } })).status,
    400,
  );

  r = await (await call(`/api/sessions/${sessionId}/approvals`, {
    method: "POST",
    body: { decisions: [{ id: r.approvals[0].id, approve: false, message: "shorter please" }] },
  })).json();
  assert.equal(r.status, "approval_required");
  assert.equal(r.approvals[0].args.body, "v2 short");
  assert.equal(await readdir(dir).then((f) => f.includes("outbox")), false, "rejection sent nothing");

  r = await (await call(`/api/sessions/${sessionId}/approvals`, {
    method: "POST",
    body: { decisions: [{ id: r.approvals[0].id, approve: true }] },
  })).json();
  assert.deepEqual(r, { status: "done", reply: "Sent v2." });

  const files = await readdir(path.join(dir, "outbox"));
  assert.equal(files.length, 1);
  assert.equal(JSON.parse(await readFile(path.join(dir, "outbox", files[0]), "utf8")).text, "v2 short");

  const { events } = await (await call("/api/audit?limit=10")).json();
  assert.deepEqual(events.map((e) => e.event), ["rejected", "approved", "email_sent"]);

  assert.equal((await call(`/api/sessions/${sessionId}/approvals`, { method: "POST", body: { decisions: [{ id: "x", approve: true }] } })).status, 409);
});

test("guidance CRUD", async () => {
  assert.equal((await call("/api/guidance", { method: "POST", body: { text: "" } })).status, 400);
  const { id } = await (await call("/api/guidance", { method: "POST", body: { text: "Keep emails under 100 words" } })).json();
  let { rules } = await (await call("/api/guidance")).json();
  assert.equal(rules.length, 1);
  assert.equal((await call(`/api/guidance/${id}`, { method: "DELETE" })).status, 200);
  ({ rules } = await (await call("/api/guidance")).json());
  assert.equal(rules.length, 0);
  assert.equal((await call(`/api/guidance/${id}`, { method: "DELETE" })).status, 404);
});

test("inbox endpoints and unknown session", async () => {
  const { emails } = await (await call("/api/inbox?unread=true")).json();
  assert.equal(emails.length, 2);
  const { email } = await (await call("/api/inbox/m1")).json();
  assert.match(email.body, /demo/);
  assert.equal((await call("/api/inbox/nope")).status, 404);
  assert.equal((await call("/api/sessions/does-not-exist/messages", { method: "POST", body: { text: "hi" } })).status, 404);
});
