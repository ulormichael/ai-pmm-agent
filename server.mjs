import { randomBytes } from "node:crypto";
import { createRuntime } from "./src/runtime.mjs";
import { createApp } from "./src/app.mjs";

if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY. Copy .env.example to .env and add your key.");
  process.exit(1);
}
const rt = await createRuntime();
let token = process.env.BECKY_API_TOKEN;
if (!token) {
  token = randomBytes(24).toString("hex");
  console.log(`BECKY_API_TOKEN not set. Temporary token for this run:\n  ${token}\nSet BECKY_API_TOKEN in .env to keep it stable.`);
}
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";
createApp({
  ...rt,
  token,
  allowedOrigin: process.env.ALLOWED_ORIGIN || "http://localhost:5173",
}).listen(port, host, () => console.log(`Becky API on http://${host}:${port}  (email mode: ${rt.email.mode})`));
