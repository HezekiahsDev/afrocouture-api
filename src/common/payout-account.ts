import { BadRequestException, Logger } from '@nestjs/common';
import { MailService } from '../mail/mail.service.js';
import type { StellarPaymentsClient } from '../payments/stellar/stellar-payments.client.js';

/** A Stellar memo: a number (MEMO_ID) or at most 28 bytes of text. */
const isValidMemo = (memo: string) => (/^\d{1,20}$/.test(memo) && BigInt(memo) <= 18_446_744_073_709_551_615n) || Buffer.byteLength(memo, 'utf8') <= 28;

/** 'bank': naira to the bank account through Paystack. 'stellar': USDC to a Stellar address. */
export type PayoutMethod = 'bank' | 'stellar';
export const PAYOUT_METHODS: readonly PayoutMethod[] = ['bank', 'stellar'];

/** Payout fields a verified artisan or merchant may still change (e.g. after a failed payout). */
export const PAYOUT_FIELDS = [
  'bankName',
  'bankCode',
  'accountNumber',
  'accountName',
  'payoutMethod',
  'stellarAddress',
  'stellarMemo',
] as const;

interface PayoutAccount {
  bankCode: string | null;
  accountNumber: string | null;
  paystackRecipientCode: string | null;
  payoutMethod?: PayoutMethod;
  stellarAddress?: string | null;
  stellarMemo?: string | null;
}

export type PayoutSnapshot = Pick<PayoutAccount, 'bankCode' | 'accountNumber' | 'payoutMethod' | 'stellarAddress' | 'stellarMemo'>;

export function payoutSnapshot(profile: PayoutAccount): PayoutSnapshot {
  return {
    bankCode: profile.bankCode ?? null,
    accountNumber: profile.accountNumber ?? null,
    payoutMethod: profile.payoutMethod ?? 'bank',
    stellarAddress: profile.stellarAddress ?? null,
    stellarMemo: profile.stellarMemo ?? null,
  };
}

/**
 * Call after applying edits. When the bank or account number changed, the stored Paystack
 * recipient no longer matches and must be recreated on the next payout. Returns what changed,
 * so the caller can send the security notice.
 */
export function resetRecipientIfChanged(profile: PayoutAccount, before: PayoutSnapshot) {
  const bankChanged = profile.bankCode !== before.bankCode || profile.accountNumber !== before.accountNumber;
  if (bankChanged) profile.paystackRecipientCode = null;
  const stellarChanged =
    (profile.payoutMethod ?? 'bank') !== (before.payoutMethod ?? 'bank') ||
    (profile.stellarAddress ?? null) !== (before.stellarAddress ?? null) ||
    (profile.stellarMemo ?? null) !== (before.stellarMemo ?? null);
  return bankChanged || stellarChanged;
}

/**
 * Normalizes the Stellar fields and, when payouts go to Stellar, checks the address can
 * receive USDC right now. Throws a 400 with a message the form can show.
 */
export async function validateStellarPayout(
  profile: PayoutAccount,
  stellar: StellarPaymentsClient | undefined,
  before?: PayoutSnapshot,
): Promise<void> {
  if (profile.stellarAddress !== undefined) profile.stellarAddress = profile.stellarAddress?.trim().toUpperCase() || null;
  if (profile.stellarMemo !== undefined) profile.stellarMemo = profile.stellarMemo?.trim() || null;
  if ((profile.payoutMethod ?? 'bank') !== 'stellar') return;
  // Only check the network when the Stellar destination is new, so unrelated edits still save if Horizon is down.
  if (before?.payoutMethod === 'stellar' && before.stellarAddress === profile.stellarAddress) return;

  if (!(await stellar?.payoutsEnabled())) throw new BadRequestException('USDC payouts are not available yet. Choose bank payouts for now.');
  if (!profile.stellarAddress) throw new BadRequestException('Add the Stellar address that should receive your USDC payouts.');
  if (profile.stellarMemo && !isValidMemo(profile.stellarMemo)) {
    throw new BadRequestException('That memo is too long: use a number or at most 28 bytes of text.');
  }
  let check;
  try {
    check = await stellar!.checkAddress(profile.stellarAddress);
  } catch {
    throw new BadRequestException('We could not check that address right now. Please try again.');
  }
  if (!check.ok) throw new BadRequestException(check.message);
}

/** Where payouts go, for the security notice: masked bank account or Stellar address. */
export function describePayoutDestination(profile: PayoutAccount): string {
  if (profile.payoutMethod === 'stellar' && profile.stellarAddress) {
    return `the Stellar address ${profile.stellarAddress.slice(0, 4)}…${profile.stellarAddress.slice(-4)} (USDC)`;
  }
  return profile.accountNumber ? `••••${profile.accountNumber.slice(-4)}` : 'a new account';
}

const logger = new Logger('PayoutAccountMail');

/** Security notice when a live account's payout destination changes. Never throws. */
export async function notifyPayoutAccountChanged(mail: MailService, to: string | undefined, destination: string) {
  if (!to) return;
  const text = `Your AfroCouture payout account was changed to ${destination}. If you didn't do this, contact support immediately.`;
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
