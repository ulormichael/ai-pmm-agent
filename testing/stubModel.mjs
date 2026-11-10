import { Usage } from "@openai/agents";

/** Scripted fake model for offline tests. Each step is { call, args } or { text }. */
export function stubModel(steps) {
  let i = 0;
  return {
    async getResponse() {
      const s = steps[i++];
      const output = s.call
        ? [{ type: "function_call", callId: `c${i}`, name: s.call, arguments: JSON.stringify(s.args), status: "completed" }]
        : [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: s.text }] }];
      return { usage: new Usage(), output, responseId: `r${i}` };
    },
    async *getStreamedResponse() { throw new Error("not used"); },
  };
}
