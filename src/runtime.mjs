import { loadConfig } from "./config.mjs";
import { createAudit } from "./audit.mjs";
import { createGuidanceStore } from "./guidance.mjs";
import { createEmailProvider } from "./email/index.mjs";
import { createTools } from "./tools/index.mjs";
import { createBecky } from "./agents/becky.mjs";

/** Wires everything together. Shared by the CLI and the HTTP API. */
export async function createRuntime(config = loadConfig(), overrides = {}) {
  const audit = createAudit(config.dataDir);
  const guidance = await createGuidanceStore(config.dataDir);
  const email = createEmailProvider(config);
  const tools = createTools({ email, audit, config });
  const becky = createBecky({ tools, guidance, model: overrides.model ?? config.model });
  return { config, audit, guidance, email, tools, becky };
}
