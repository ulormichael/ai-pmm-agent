import "dotenv/config";

const list = (v) => (v || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const bool = (v, d) => (v === undefined || v === "" ? d : v === "true");

export function loadConfig(env = process.env) {
  const smtpReady = !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
  const imapReady = !!(env.IMAP_HOST && env.IMAP_USER && env.IMAP_PASS);
  return {
    agentName: "Becky",
    model: env.OPENAI_MODEL || undefined,
    dataDir: env.BECKY_DATA_DIR || "./data",
    email: {
      mode: smtpReady && imapReady ? "live" : "mock",
      address: env.EMAIL_ADDRESS || env.SMTP_USER || "becky@localhost",
      fromName: env.EMAIL_FROM_NAME || "Becky (AI Assistant)",
      signature: env.EMAIL_SIGNATURE || "",
      allowedRecipients: list(env.EMAIL_ALLOWED_RECIPIENTS),
      maxPerSession: Number(env.EMAIL_MAX_PER_SESSION || 20),
      smtp: {
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT || 465),
        secure: bool(env.SMTP_SECURE, true),
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      },
      imap: {
        host: env.IMAP_HOST,
        port: Number(env.IMAP_PORT || 993),
        secure: bool(env.IMAP_SECURE, true),
        auth: { user: env.IMAP_USER, pass: env.IMAP_PASS },
        logger: false,
      },
    },
  };
}
