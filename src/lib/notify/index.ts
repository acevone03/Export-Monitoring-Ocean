import type { PrismaClient } from "@prisma/client";
import { sendMail } from "../mailer";

// Delivery channels behind one interface (spec 7.4). The alert engine only knows `Notifier`;
// adding SMS or Viber means adding a class here and listing it in defaultNotifiers().

export type Recipient = { userId: string; name: string; email: string; telegramId: string | null };
export type AlertMessage = { alertId: string; subject: string; text: string; link: string; at: Date };
export type SendResult = "sent" | "skipped";

export interface Notifier {
  readonly channel: string;
  send(to: Recipient, msg: AlertMessage): Promise<SendResult>;
}

/** Notification center rows (one per recipient). */
export class InAppNotifier implements Notifier {
  readonly channel = "IN_APP";
  constructor(private readonly db: PrismaClient) {}
  async send(to: Recipient, msg: AlertMessage): Promise<SendResult> {
    await this.db.notification.create({
      data: { userId: to.userId, alertId: msg.alertId, title: msg.subject, body: msg.text, link: msg.link, createdAt: msg.at },
    });
    return "sent";
  }
}

export class EmailNotifier implements Notifier {
  readonly channel = "EMAIL";
  async send(to: Recipient, msg: AlertMessage): Promise<SendResult> {
    await sendMail({ to: [to.email], subject: msg.subject, text: `${msg.text}\n\nOpen: ${msg.link}\n` });
    return "sent";
  }
}

/**
 * [OPEN: confirm channel] Stub only. When a bot token is configured and the user has a
 * Telegram chat id, this is where the Bot API call would go. Until then it skips silently.
 */
export class TelegramNotifier implements Notifier {
  readonly channel = "TELEGRAM";
  async send(to: Recipient, _msg: AlertMessage): Promise<SendResult> {
    if (!process.env.TELEGRAM_BOT_TOKEN || !to.telegramId) return "skipped";
    // POST https://api.telegram.org/bot<token>/sendMessage { chat_id, text } — not implemented in MVP.
    return "skipped";
  }
}

export function defaultNotifiers(db: PrismaClient): Notifier[] {
  return [new InAppNotifier(db), new EmailNotifier(), new TelegramNotifier()];
}
