import { createInterface } from "node:readline/promises";
import { run, user } from "@openai/agents";
import { createRuntime } from "./runtime.mjs";
import { resolveApprovals } from "./approvals.mjs";

const HELP = `
Commands (anything else is sent to Becky):
  /guide <text>     add standing guidance Becky must follow (applies immediately, persists)
  /guides           list standing guidance
  /unguide <id>     remove a guidance rule
  /inbox            list unread emails (no AI involved)
  /reset            clear the conversation (guidance is kept)
  /help             show this help
  /exit             quit
During an approval: y = approve, n = reject, or type guidance to reject AND tell Becky what to change.
`;

export async function startCli() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY. Copy .env.example to .env and add your key.");
    process.exit(1);
  }
  const { audit, guidance, email, becky } = await createRuntime();
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const decide = async ({ name, args }) => {
    console.log("\n=== APPROVAL NEEDED ===");
    console.log(`Becky wants to run: ${name}`);
    if (name === "reply_to_email") {
      try {
        const o = await email.getMessage(args.id);
        console.log(`Replying to: ${o.from}  |  Subject: ${o.subject}`);
      } catch {}
    }
    if (args.to) console.log(`To:      ${args.to.join(", ")}`);
    if (args.cc?.length) console.log(`Cc:      ${args.cc.join(", ")}`);
    if (args.subject) console.log(`Subject: ${args.subject}`);
    console.log(`\n${args.body ?? JSON.stringify(args, null, 2)}\n`);
    if (email.mode === "mock") console.log("(mock mode: approving will NOT send a real email)");
    const ans = (await rl.question("Approve? [y]es / [n]o / or type guidance to reject & revise: ")).trim();
    if (/^y(es)?$/i.test(ans)) return { approve: true };
    if (/^n(o)?$/i.test(ans) || !ans) return { approve: false };
    return { approve: false, message: ans };
  };

  console.log(`Becky is ready. Email mode: ${email.mode.toUpperCase()}. Type /help for commands.`);
  let history = [];
  let pending = process.argv.slice(2).join(" ").trim();

  while (true) {
    const line = pending || (await rl.question("\nYou> ")).trim();
    pending = "";
    if (!line) continue;

    if (line === "/exit") break;
    if (line === "/help") { console.log(HELP); continue; }
    if (line === "/reset") { history = []; console.log("Conversation cleared."); continue; }
    if (line === "/guides") {
      const g = guidance.list();
      console.log(g.length ? g.map((r) => `${r.id}. ${r.text}`).join("\n") : "No standing guidance set.");
      continue;
    }
    if (line.startsWith("/guide ")) {
      const id = await guidance.add(line.slice(7));
      await audit.log("guidance_added", { id, text: line.slice(7) });
      console.log(`Guidance #${id} saved.`);
      continue;
    }
    if (line.startsWith("/unguide ")) {
      const ok = await guidance.remove(line.slice(9));
      console.log(ok ? "Removed." : "No rule with that id.");
      continue;
    }
    if (line === "/inbox") {
      try {
        const items = await email.listInbox({ limit: 10, unreadOnly: true });
        console.log(items.length ? items.map((m) => `[${m.id}] ${m.from} | ${m.subject}`).join("\n") : "No unread emails.");
      } catch (e) { console.error("Inbox error:", e.message); }
      continue;
    }

    try {
      let result = await run(becky, [...history, user(line)]);
      result = await resolveApprovals(becky, result, { decide, audit });
      history = result.history;
      console.log(`\nBecky> ${result.finalOutput ?? "(no response)"}`);
    } catch (e) {
      console.error("Error:", e.message);
    }
  }
  rl.close();
}
