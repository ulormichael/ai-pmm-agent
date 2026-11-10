import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

/** Safe offline provider: reads data/mock-inbox.json, "sends" by writing files to data/outbox/. */
export function createMockEmail(config) {
  const inboxFile = path.join(config.dataDir, "mock-inbox.json");
  const outboxDir = path.join(config.dataDir, "outbox");
  const load = async () => JSON.parse(await readFile(inboxFile, "utf8").catch(() => "[]"));
  return {
    mode: "mock",
    async listInbox({ limit = 10, unreadOnly = false } = {}) {
      const all = (await load()).filter((m) => !unreadOnly || m.unread);
      return all.slice(-limit).reverse().map(({ body, ...m }) => m);
    },
    async getMessage(id) {
      const m = (await load()).find((x) => x.id === String(id));
      if (!m) throw new Error(`No email with id ${id}`);
      return m;
    },
    async send(msg) {
      await mkdir(outboxDir, { recursive: true });
      const id = `out-${Date.now()}`;
      await writeFile(path.join(outboxDir, `${id}.json`), JSON.stringify(msg, null, 2));
      return { id, note: `MOCK MODE: saved to data/outbox/${id}.json (nothing was actually sent)` };
    },
  };
}
