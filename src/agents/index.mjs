
import "dotenv/config";
import { Agent, run } from "@openai/agents";
import { WebClient } from "@slack/web-api";
import { createInterface } from "node:readline/promises";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
const terminal = createInterface({
  input: process.stdin,
  output: process.stdout,
});

const agent = new Agent({
  name: "Slack Posting Assistant",
  instructions: `
    You are my professional Slack communications assistant.
    Write clear, concise, friendly workplace messages.
    Use bullets when helpful.
    Never invent project updates, deadlines, or achievements.
    Return only the message intended for Slack.
  `,
});

async function main() {
  const request = await terminal.question(
    "What should I post on Slack? "
  );

  const result = await run(agent, request);
  const draft = result.finalOutput;

  console.log("\n--- MESSAGE PREVIEW ---\n");
  console.log(draft);

  const approval = await terminal.question(
    "\nPost this message to Slack? (y/n): "
  );

  if (approval.trim().toLowerCase() !== "y") {
    console.log("Posting cancelled.");
    return;
  }

  const response = await slack.chat.postMessage({
    channel: process.env.SLACK_CHANNEL_ID,
    text: draft,
  });

  if (!response.ok) {
    throw new Error("Slack did not confirm the message.");
  }

  console.log("Message posted successfully.");
}

main()
  .catch(console.error)
  .finally(() => terminal.close());