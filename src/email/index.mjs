import { createMockEmail } from "./mock.mjs";
import { createLiveEmail } from "./live.mjs";

export function createEmailProvider(config) {
  return config.email.mode === "live" ? createLiveEmail(config) : createMockEmail(config);
}
