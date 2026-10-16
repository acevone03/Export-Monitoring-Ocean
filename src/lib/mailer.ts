import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";

// Outgoing email. With SMTP_HOST set, mail goes through SMTP. Without it (demo/dev), each
// message is written as JSON to OUTBOX_DIR and can be read at /dev/outbox, so a demo can
// "receive" alert emails without a mail server.

export type Mail = {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
};

const outboxDir = () => process.env.OUTBOX_DIR || "./outbox";

let transport: nodemailer.Transporter | null = null;
function smtp() {
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
}

export const smtpConfigured = () => !!process.env.SMTP_HOST;

export async function sendMail(mail: Mail): Promise<void> {
  if (mail.to.length === 0) return;
  const from = process.env.SMTP_FROM || "NNR Export Monitor <noreply@example.com>";
  if (smtpConfigured()) {
    await smtp().sendMail({ from, ...mail });
    return;
  }
  const dir = outboxDir();
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${stamp}-${Math.random().toString(36).slice(2, 8)}.json`);
  await writeFile(
    file,
    JSON.stringify(
      {
        from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html ?? null,
        attachments: (mail.attachments ?? []).map((a) => ({ filename: a.filename, size: a.content.length })),
        writtenAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

export type OutboxItem = { file: string; from: string; to: string[]; subject: string; text: string; writtenAt: string; attachments: Array<{ filename: string; size: number }> };

/** Newest first. Dev/demo only. */
export async function readOutbox(limit = 50): Promise<OutboxItem[]> {
  const dir = outboxDir();
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".json")).sort().reverse().slice(0, limit);
  return Promise.all(files.map(async (f) => ({ file: f, ...JSON.parse(await readFile(path.join(dir, f), "utf8")) })));
}
