import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Standing human guidance for Becky. Persisted to disk, re-read on every model
 * turn, so a rule added with /guide takes effect immediately and survives restarts.
 */
export async function createGuidanceStore(dataDir) {
  const file = path.join(dataDir, "guidance.json");
  let rules = [];
  try {
    rules = JSON.parse(await readFile(file, "utf8"));
  } catch {
    rules = [];
  }
  const save = async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(file, JSON.stringify(rules, null, 2));
  };
  return {
    list: () => [...rules],
    async add(text) {
      const id = (rules.at(-1)?.id ?? 0) + 1;
      rules.push({ id, text: text.trim(), createdAt: new Date().toISOString() });
      await save();
      return id;
    },
    async remove(id) {
      const before = rules.length;
      rules = rules.filter((r) => r.id !== Number(id));
      await save();
      return rules.length < before;
    },
  };
}
