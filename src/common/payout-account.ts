import { Logger } from '@nestjs/common';
import { MailService } from '../mail/mail.service.js';

/** Payout fields a verified artisan or merchant may still change (e.g. after a failed payout). */
export const PAYOUT_FIELDS = ['bankName', 'bankCode', 'accountNumber', 'accountName'] as const;

interface PayoutAccount {
  bankCode: string | null;
  accountNumber: string | null;
  paystackRecipientCode: string | null;
}

/**
 * Call after applying edits: when the bank or account number changed, the stored Paystack
 * recipient no longer matches and must be recreated on the next payout. Returns whether it changed.
 */
export function resetRecipientIfChanged(profile: PayoutAccount, before: Pick<PayoutAccount, 'bankCode' | 'accountNumber'>) {
  const changed = profile.bankCode !== before.bankCode || profile.accountNumber !== before.accountNumber;
  if (changed) profile.paystackRecipientCode = null;
  return changed;
}

const logger = new Logger('PayoutAccountMail');

/** Security notice when a live account's payout destination changes. Never throws. */
export async function notifyPayoutAccountChanged(mail: MailService, to: string | undefined, accountNumber: string | null) {
  if (!to) return;
  const masked = accountNumber ? `••••${accountNumber.slice(-4)}` : 'a new account';
  const text = `Your AfroCouture payout account was changed to ${masked}. If you didn't do this, contact support immediately.`;
  try {
    await mail.sendMail({
      to,
      subject: 'Your payout account was changed',
      text,
      html: `<div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:520px"><h2 style="color:#00a3ff;margin:0 0 8px">Your payout account was changed</h2><p>${text}</p></div>`,
    });
  } catch (err) {
    logger.error(`Could not send payout change notice to ${to}`, err as Error);
  }
}
