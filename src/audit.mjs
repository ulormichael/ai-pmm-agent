import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Append-only JSONL audit trail of every approval decision and email sent. */
export function createAudit(dataDir) {
  const file = path.join(dataDir, "audit.jsonl");
  return {
    file,
    async log(event, details = {}) {
      await mkdir(dataDir, { recursive: true });
      await appendFile(file, JSON.stringify({ at: new Date().toISOString(), event, ...details }) + "\n");
    },
    async tail(n = 50) {
      const text = await readFile(file, "utf8").catch(() => "");
      return text.trim().split("\n").filter(Boolean).slice(-n).map((l) => JSON.parse(l));
    },
  };
}
