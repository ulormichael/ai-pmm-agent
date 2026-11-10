
import "dotenv/config";
import { Agent, run } from "@openai/agents";

const pmmAgent = new Agent({
  name: "AI Product Marketing Assistant",

  instructions: `
    You are an experienced Technical Product Marketing Manager.

    Help users with:
    - Product positioning and messaging
    - Customer personas
    - Go-to-market strategy
    - Product launch campaigns
    - Sales enablement

    Ask for missing product information when necessary.
    Never invent customer research or market data.
    Give practical, structured recommendations.
  `,
});

async function main() {
  const result = await run(
    pmmAgent,
    `Create a launch campaign outline for Scoutflair,
     a football scouting platform that helps players
     showcase their profiles and helps scouts discover talent.`
  );

  console.log(result.finalOutput);
}

main().catch(console.error);