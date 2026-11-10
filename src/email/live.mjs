import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

/** Real provider: SMTP (nodemailer) to send, IMAP (imapflow + mailparser) to read. */
export function createLiveEmail(config) {
  const { smtp, imap, address, fromName } = config.email;
  const transport = nodemailer.createTransport(smtp);

  async function withImap(fn) {
    const client = new ImapFlow(imap);
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      return await fn(client);
    } finally {
      lock.release();
      await client.logout().catch(() => {});
    }
  }

  return {
    mode: "live",
    async listInbox({ limit = 10, unreadOnly = false } = {}) {
      return withImap(async (client) => {
        const uids = (await client.search(unreadOnly ? { seen: false } : { all: true }, { uid: true })) || [];
        const pick = uids.slice(-limit);
        const out = [];
        if (!pick.length) return out;
        for await (const m of client.fetch(pick, { uid: true, envelope: true, flags: true }, { uid: true })) {
          const f = m.envelope.from?.[0];
          out.push({
            id: String(m.uid),
            from: f ? `${f.name || ""} <${f.address}>`.trim() : "unknown",
            subject: m.envelope.subject || "(no subject)",
            date: m.envelope.date?.toISOString?.() ?? null,
            unread: !m.flags.has("\\Seen"),
          });
        }
        return out.reverse();
      });
    },
    async getMessage(id) {
      return withImap(async (client) => {
        const m = await client.fetchOne(String(id), { uid: true, source: true }, { uid: true });
        if (!m?.source) throw new Error(`No email with id ${id}`);
        const p = await simpleParser(m.source);
        return {
          id: String(id),
          from: p.from?.text,
          replyTo: p.replyTo?.value?.[0]?.address || p.from?.value?.[0]?.address,
          to: p.to?.text,
          subject: p.subject,
          date: p.date?.toISOString?.(),
          messageId: p.messageId,
          references: p.references,
          body: p.text || "(no plain-text body)",
        };
      });
    },
    async send({ to, cc, subject, text, inReplyTo, references }) {
      const info = await transport.sendMail({
        from: `"${fromName}" <${address}>`,
        to,
        cc: cc?.length ? cc : undefined,
        subject,
        text,
        inReplyTo,
        references,
      });
      return { id: info.messageId, note: "Sent via SMTP" };
    },
  };
}
