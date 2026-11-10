import { run } from "@openai/agents";

/**
 * Human-in-the-loop loop. While the agent has pending tool calls that need
 * approval, ask `decide(item)` and feed the answer back in.
 * decide returns { approve: true } or { approve: false, message?: string }.
 */
export async function resolveApprovals(agent, result, { decide, audit }) {
  while (result.interruptions?.length) {
    for (const item of result.interruptions) {
      const name = item.toolName ?? item.rawItem?.name;
      const args = safeParse(item.rawItem?.arguments);
      const d = await decide({ item, name, args });
      await audit?.log(d.approve ? "approved" : "rejected", { tool: name, args, guidance: d.message });
      if (d.approve) {
        result.state.approve(item);
      } else {
        result.state.reject(item, {
          message: `The human reviewer REJECTED this action.${d.message ? ` Their guidance: ${d.message}` : ""} Do not retry unchanged. Revise per their guidance, or ask them what they want.`,
        });
      }
    }
    result = await run(agent, result.state);
  }
  return result;
}

export function safeParse(s) {
  try {
    return typeof s === "string" ? JSON.parse(s) : (s ?? {});
  } catch {
    return {};
  }
}

export const itemName = (item) => item.toolName ?? item.rawItem?.name;
export const itemId = (item) => item.rawItem?.callId ?? item.rawItem?.id;

/** Describe pending approvals for a UI (non-blocking flow). */
export async function describeInterruptions(result, email) {
  return Promise.all(
    result.interruptions.map(async (item) => {
      const name = itemName(item);
      const args = safeParse(item.rawItem?.arguments);
      let context = null;
      if (name === "reply_to_email") {
        try {
          const o = await email.getMessage(args.id);
          context = { replyingTo: o.from, originalSubject: o.subject };
        } catch {}
      }
      return { id: itemId(item), tool: name, args, context, emailMode: email.mode };
    }),
  );
}

/**
 * Apply human decisions to a paused run, then resume it.
 * decisions: [{ id, approve: boolean, message?: string }] covering every pending item.
 */
export async function applyDecisions(agent, result, decisions, audit) {
  const byId = new Map(decisions.map((d) => [d.id, d]));
  const missing = result.interruptions.filter((i) => !byId.has(itemId(i))).map(itemId);
  if (missing.length) {
    const err = new Error(`Missing decisions for: ${missing.join(", ")}`);
    err.status = 400;
    throw err;
  }
  for (const item of result.interruptions) {
    const d = byId.get(itemId(item));
    await audit?.log(d.approve ? "approved" : "rejected", {
      tool: itemName(item), args: safeParse(item.rawItem?.arguments), guidance: d.message, via: "api",
    });
    if (d.approve) result.state.approve(item);
    else
      result.state.reject(item, {
        message: `The human reviewer REJECTED this action.${d.message ? ` Their guidance: ${d.message}` : ""} Do not retry unchanged. Revise per their guidance, or ask them what they want.`,
      });
  }
  return run(agent, result.state);
}
