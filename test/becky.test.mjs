import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { run, user, setTracingDisabled } from "@openai/agents";
import { stubModel } from "../testing/stubModel.mjs";
import { loadConfig } from "../src/config.mjs";
import { createAudit } from "../src/audit.mjs";
import { createGuidanceStore } from "../src/guidance.mjs";
import { createEmailProvider } from "../src/email/index.mjs";
import { createTools } from "../src/tools/index.mjs";
import { createBecky, buildInstructions } from "../src/agents/becky.mjs";
import { resolveApprovals } from "../src/approvals.mjs";

setTracingDisabled(true);

async function setup(env = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "becky-"));
  await cp(new URL("../data/mock-inbox.json", import.meta.url), path.join(dir, "mock-inbox.json"));
  const config = loadConfig({ BECKY_DATA_DIR: dir, ...env });
  const audit = createAudit(dir);
  const guidance = await createGuidanceStore(dir);
  const email = createEmailProvider(config);
  const tools = createTools({ email, audit, config });
  return { dir, config, audit, guidance, email, tools };
}

const toolByName = (tools, n) => tools.find((t) => t.name === n);

test("conversion rate tool", async () => {
  const { tools } = await setup();
  const t = toolByName(tools, "calculate_conversion_rate");
  assert.equal(await t.invoke({}, JSON.stringify({ visitors: 2000, conversions: 100 })), "5.00%");
  assert.match(await t.invoke({}, JSON.stringify({ visitors: 10, conversions: 20 })), /cannot exceed/);
});

test("mock inbox lists and reads email; read is marked untrusted", async () => {
  const { tools } = await setup();
  const list = await toolByName(tools, "check_inbox").invoke({}, JSON.stringify({ limit: null, unread_only: true }));
  assert.match(list, /Scoutflair pricing/);
  const read = await toolByName(tools, "read_email").invoke({}, JSON.stringify({ id: "m1" }));
  assert.match(read, /UNTRUSTED/);
  assert.match(read, /demo/);
});

test("send_email and reply_to_email require approval", async () => {
  const { tools } = await setup();
  for (const n of ["send_email", "reply_to_email"]) {
    assert.ok(toolByName(tools, n).needsApproval, `${n} must need approval`);
  }
});

test("approve flow: nothing is sent until approved, then outbox + audit written", async () => {
  const { dir, config, audit, guidance, tools } = await setup();
  const becky = createBecky({
    tools, guidance,
    model: stubModel([
      { call: "send_email", args: { to: ["scout@example.com"], cc: null, subject: "Demo", body: "Hi, happy to demo." } },
      { text: "Sent." },
    ]),
  });
  let r = await run(becky, [user("email the scout")]);
  assert.equal(r.interruptions.length, 1);
  assert.deepEqual(await readdir(dir).then((f) => f.filter((x) => x === "outbox")), [], "no outbox before approval");
  r = await resolveApprovals(becky, r, { decide: async () => ({ approve: true }), audit });
  assert.equal(r.finalOutput, "Sent.");
  const files = await readdir(path.join(dir, "outbox"));
  assert.equal(files.length, 1);
  const sent = JSON.parse(await readFile(path.join(dir, "outbox", files[0]), "utf8"));
  assert.equal(sent.subject, "Demo");
  const log = (await readFile(audit.file, "utf8")).trim().split("\n").map(JSON.parse).map((e) => e.event);
  assert.deepEqual(log, ["approved", "email_sent"]);
});

test("reject with guidance: nothing sent, Becky revises, second draft sent after approval", async () => {
  const { dir, audit, guidance, tools } = await setup();
  const becky = createBecky({
    tools, guidance,
    model: stubModel([
      { call: "send_email", args: { to: ["scout@example.com"], cc: null, subject: "Demo", body: "v1" } },
      { call: "send_email", args: { to: ["scout@example.com"], cc: null, subject: "Demo", body: "v2 shorter" } },
      { text: "Done." },
    ]),
  });
  const decisions = [{ approve: false, message: "make it shorter" }, { approve: true }];
  let r = await run(becky, [user("email the scout")]);
  r = await resolveApprovals(becky, r, { decide: async () => decisions.shift(), audit });
  assert.equal(r.finalOutput, "Done.");
  const files = await readdir(path.join(dir, "outbox"));
  assert.equal(files.length, 1);
  assert.equal(JSON.parse(await readFile(path.join(dir, "outbox", files[0]), "utf8")).text, "v2 shorter");
});

test("reply_to_email threads correctly", async () => {
  const { dir, audit, guidance, tools } = await setup();
  const becky = createBecky({
    tools, guidance,
    model: stubModel([{ call: "reply_to_email", args: { id: "m1", body: "Thanks!" } }, { text: "ok" }]),
  });
  let r = await run(becky, [user("reply to m1")]);
  r = await resolveApprovals(becky, r, { decide: async () => ({ approve: true }), audit });
  const f = (await readdir(path.join(dir, "outbox")))[0];
  const sent = JSON.parse(await readFile(path.join(dir, "outbox", f), "utf8"));
  assert.deepEqual(sent.to, ["scout@example.com"]);
  assert.equal(sent.subject, "Re: Question about Scoutflair pricing");
  assert.equal(sent.inReplyTo, "<sample-1@example.com>");
});

test("recipient allow-list blocks even approved sends", async () => {
  const { dir, audit, guidance, tools } = await setup({ EMAIL_ALLOWED_RECIPIENTS: "mycompany.com" });
  const send = toolByName(tools, "send_email");
  const out = await send.invoke({}, JSON.stringify({ to: ["x@evil.com"], cc: null, subject: "s", body: "b" }));
  assert.match(String(out), /allow-list/i);
  assert.equal(await readdir(dir).then((f) => f.includes("outbox")), false);
});

test("guidance persists and is injected into instructions", async () => {
  const { dir, guidance } = await setup();
  const id = await guidance.add("Always sign off as 'Becky, ValueGate'");
  const again = await createGuidanceStore(dir);
  assert.equal(again.list().length, 1);
  assert.match(buildInstructions(again.list()), /sign off as 'Becky, ValueGate'/);
  await again.remove(id);
  assert.match(buildInstructions(again.list()), /none set/);
});
