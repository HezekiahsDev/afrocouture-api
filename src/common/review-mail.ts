import { Logger } from '@nestjs/common';
import { MailService } from '../mail/mail.service.js';

const logger = new Logger('ReviewMail');

/** Best-effort email telling an applicant the outcome of their verification. Never throws. */
export async function sendReviewOutcome(
  mail: MailService,
  to: string,
  kind: 'artisan' | 'merchant',
  approved: boolean,
  note?: string | null,
): Promise<void> {
  const label = kind === 'artisan' ? 'artisan profile' : 'merchant account';
  const subject = approved ? `Your ${label} is verified` : `Your ${label} needs changes`;
  const text = approved
    ? `Good news — your AfroCouture AI ${label} has been verified and is now live on the marketplace.`
    : `We couldn't verify your AfroCouture AI ${label} yet.\n\nReason: ${note}\n\nUpdate your details and submit again.`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:520px">
      <h2 style="color:${approved ? '#10b981' : '#00a3ff'};margin:0 0 8px">${subject}</h2>
      <p>${text.replace(/\n/g, '<br>')}</p>
    </div>`;

  try {
    await mail.sendMail({ to, subject, text, html });
  } catch (err) {
    logger.error(`Could not send review outcome to ${to}`, err as Error);
  }
}
