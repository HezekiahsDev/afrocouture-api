import { Logger } from '@nestjs/common';
import { MailService } from '../mail/mail.service.js';

const logger = new Logger('OrderMail');

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Best-effort order notification. Never throws — an email failure must not undo an order change. */
export async function sendOrderMail(
  mail: MailService,
  to: string | null | undefined,
  subject: string,
  lines: string[],
  link?: string,
): Promise<void> {
  if (!to) return;
  const text = [...lines, link ? `\nOpen the order: ${link}` : ''].join('\n').trim();
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:520px">
      <h2 style="color:#00a3ff;margin:0 0 8px">${escape(subject)}</h2>
      ${lines.map((l) => `<p style="margin:0 0 8px">${escape(l)}</p>`).join('')}
      ${link ? `<p><a href="${escape(link)}" style="color:#00a3ff;font-weight:600">Open the order</a></p>` : ''}
    </div>`;
  try {
    await mail.sendMail({ to, subject, text, html });
  } catch (err) {
    logger.error(`Could not send "${subject}" to ${to}`, err as Error);
  }
}
