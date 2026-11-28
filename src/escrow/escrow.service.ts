import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, LessThan, Repository } from 'typeorm';
import { randomBytes } from 'node:crypto';
import {
  EscrowTransaction,
  EscrowTransactionStatus as TxStatus,
  EscrowTransactionType as TxType,
  PaymentProvider,
} from './entities/escrow-transaction.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import { TailorProfile } from '../tailors/entities/tailor-profile.entity.js';
import { MerchantProfile } from '../merchants/entities/merchant-profile.entity.js';
import { PaystackError, PaystackService } from '../payments/paystack.service.js';
import { ServiceTransfer, StellarPaymentsClient, StellarServiceError } from '../payments/stellar/stellar-payments.client.js';
import { AlertsService } from '../common/alerts/alerts.service.js';

export interface EscrowSummary {
  held: number;
  released: number;
  refunded: number;
  balance: number;
}

/** Provider details stored on a HOLD. Paystack holds need none. */
export interface HoldDetails {
  provider: PaymentProvider;
  /** Stellar: the service's payment id (refunds are made against it). */
  providerCode?: string | null;
  assetAmount?: string | null;
  fxRate?: string | null;
  txHash?: string | null;
  /** Where refunds of this payment go. */
  destination?: string | null;
  destinationMemo?: string | null;
}

/** Releases and refunds that count against the balance (a failed or reversed one gave the money back). */
const COMMITTED = [TxStatus.PENDING, TxStatus.SUCCESS];
const RELEASES = [TxType.RELEASE_TAILOR, TxType.RELEASE_MERCHANT];

const shortId = () => randomBytes(4).toString('hex').toUpperCase();

/**
 * The ledger behind every order: one HOLD when the customer pays, then payouts to
 * the tailor and merchants and any refunds. Money only moves through this service.
 * `amount` is whole naira for every provider; Paystack or Stellar only move it.
 */
@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(EscrowTransaction) private readonly txRepository: Repository<EscrowTransaction>,
    private readonly paystack: PaystackService,
    @Optional() private readonly alerts?: AlertsService,
    @Optional() private readonly stellar?: StellarPaymentsClient,
  ) {}

  // ── Reads ──

  async summary(orderId: string, em: EntityManager = this.dataSource.manager): Promise<EscrowSummary> {
    const rows = await em.find(EscrowTransaction, { where: { orderId } });
    let held = 0;
    let released = 0;
    let refunded = 0;
    for (const tx of rows) {
      if (tx.type === TxType.HOLD) {
        if (tx.status === TxStatus.SUCCESS) held += tx.amount;
      } else if (COMMITTED.includes(tx.status)) {
        if (tx.type === TxType.REFUND) refunded += tx.amount;
        else released += tx.amount;
      }
    }
    return { held, released, refunded, balance: held - released - refunded };
  }

  listForOrder(orderId: string): Promise<EscrowTransaction[]> {
    return this.txRepository.find({ where: { orderId }, order: { createdAt: 'ASC' } });
  }

  /** Payouts and refunds in a status, or every transaction (newest first) for 'all'. */
  listByStatus(status: TxStatus | 'all'): Promise<EscrowTransaction[]> {
    if (status === 'all') return this.txRepository.find({ order: { createdAt: 'DESC' }, take: 500 });
    return this.txRepository.find({ where: { status }, order: { createdAt: 'ASC' } });
  }

  /** Whether a payout to this party is already committed (pending or paid). */
  async hasRelease(orderId: string, partyId: string, em: EntityManager = this.dataSource.manager): Promise<boolean> {
    return em.exists(EscrowTransaction, {
      where: { orderId, partyId, type: In(RELEASES), status: In(COMMITTED) },
    });
  }

  // ── Holds ──

  /** Records the customer's verified payment. Must run inside the caller's locked transaction. */
  async recordHold(em: EntityManager, order: Order, reference: string, amount: number, details?: HoldDetails): Promise<void> {
    const existing = await em.findOne(EscrowTransaction, { where: { reference } });
    if (existing) return;
    await em.save(
      em.create(EscrowTransaction, {
        orderId: order.id,
        type: TxType.HOLD,
        status: TxStatus.SUCCESS,
        amount,
        partyType: 'customer',
        partyId: order.customerId,
        reference,
        provider: details?.provider ?? PaymentProvider.PAYSTACK,
        assetAmount: details?.assetAmount ?? null,
        fxRate: details?.fxRate ?? null,
        txHash: details?.txHash ?? null,
        providerCode: details?.providerCode ?? details?.txHash ?? null,
        destination: details?.destination ?? null,
        destinationMemo: details?.destinationMemo ?? null,
      }),
    );
  }

  // ── Payouts ──

  /**
   * Commits a payout inside the caller's locked transaction and returns the pending row,
   * or null when the party was already paid or there's nothing to pay. Call `execute()`
   * on the result after the transaction commits.
   */
  async reserveRelease(
    em: EntityManager,
    order: Order,
    party: { type: 'tailor' | 'merchant'; id: string },
    amount: number,
  ): Promise<EscrowTransaction | null> {
    if (amount <= 0) return null;
    if (await this.hasRelease(order.id, party.id, em)) return null;

    const { balance } = await this.summary(order.id, em);
    const payable = Math.min(amount, balance);
    if (payable <= 0) return null;

    return em.save(
      em.create(EscrowTransaction, {
        orderId: order.id,
        type: party.type === 'tailor' ? TxType.RELEASE_TAILOR : TxType.RELEASE_MERCHANT,
        status: TxStatus.PENDING,
        amount: payable,
        partyType: party.type,
        partyId: party.id,
        reference: `${order.reference}-P-${shortId()}`,
        provider: await this.payoutProvider(em, party),
      }),
    );
  }

  /**
   * Commits a refund inside the caller's locked transaction; call `execute()` after commit.
   * `holdReference` picks the payment to refund (default: the order's first successful one).
   */
  async reserveRefund(em: EntityManager, order: Order, amount: number, holdReference?: string): Promise<EscrowTransaction | null> {
    const { balance } = await this.summary(order.id, em);
    const refundable = Math.min(amount, balance);
    if (refundable <= 0) return null;
    const hold = holdReference
      ? await em.findOne(EscrowTransaction, { where: { reference: holdReference, type: TxType.HOLD } })
      : await em.findOne(EscrowTransaction, { where: { orderId: order.id, type: TxType.HOLD, status: TxStatus.SUCCESS } });
    return em.save(
      em.create(EscrowTransaction, {
        orderId: order.id,
        type: TxType.REFUND,
        status: TxStatus.PENDING,
        amount: refundable,
        partyType: 'customer',
        partyId: order.customerId,
        reference: `${order.reference}-R-${shortId()}`,
        provider: hold?.provider ?? PaymentProvider.PAYSTACK,
        holdReference: hold?.reference ?? null,
      }),
    );
  }

  /**
   * Sends a reserved payout or refund through its provider. Never throws: failures are
   * stored on the transaction for an admin to retry.
   */
  async execute(tx: EscrowTransaction): Promise<EscrowTransaction> {
    if (tx.provider === PaymentProvider.STELLAR) return this.executeStellar(tx);
    try {
      if (tx.type === TxType.REFUND) {
        const hold = await this.holdFor(tx);
        if (!hold) return this.fail(tx, 'No successful payment to refund');
        const refund = await this.paystack.refund({ transactionReference: hold.reference, amountKobo: tx.amount * 100 });
        tx.providerCode = refund.id;
        tx.status = refund.status === 'processed' ? TxStatus.SUCCESS : TxStatus.PENDING;
      } else {
        const recipient = await this.recipientFor(tx);
        if (!recipient) return this.fail(tx, 'Payout account incomplete');
        const transfer = await this.paystack.transfer({
          amountKobo: tx.amount * 100,
          recipient,
          reference: tx.reference,
          reason: `AfroCouture order payout ${tx.reference}`,
        });
        tx.providerCode = transfer.transferCode;
        tx.status = transfer.status === 'success' ? TxStatus.SUCCESS : TxStatus.PENDING;
        if (transfer.status === 'failed' || transfer.status === 'reversed') {
          return this.fail(tx, `Paystack reported the transfer as ${transfer.status}`);
        }
      }
      tx.failureReason = null;
      return await this.txRepository.save(tx);
    } catch (err) {
      const reason = err instanceof PaystackError ? err.message : 'Unexpected error sending the payout';
      if (!(err instanceof PaystackError)) this.logger.error(`Escrow ${tx.reference} failed`, err as Error);
      return this.fail(tx, reason);
    }
  }

  /** Admin: send a failed payout or refund again (with a fresh reference — Paystack references are single-use). */
  async retry(id: string): Promise<EscrowTransaction> {
    const tx = await this.txRepository.findOne({ where: { id } });
    if (!tx) throw new NotFoundException('Transaction not found.');
    if (tx.status !== TxStatus.FAILED) throw new ConflictException(`This transaction is ${tx.status}; only failed ones can be retried.`);
    if (tx.type === TxType.HOLD) throw new BadRequestException('Payments cannot be retried.');

    // A new payout to the same party may already have been committed since this one failed.
    if (tx.type !== TxType.REFUND && (await this.hasRelease(tx.orderId, tx.partyId))) {
      throw new ConflictException('This party already has a newer payout for this order.');
    }
    const { balance } = await this.summary(tx.orderId);
    if (tx.amount > balance) throw new ConflictException('Not enough left in escrow for this payout.');

    const wasStellar = tx.provider === PaymentProvider.STELLAR;
    // The payee may have switched between bank and Stellar since the failure.
    if (tx.type !== TxType.REFUND) {
      tx.provider = await this.payoutProvider(this.dataSource.manager, { type: tx.partyType as 'tailor' | 'merchant', id: tx.partyId });
    }
    // Stellar: the service retries the same transfer (same reference, so it can never double-pay).
    if (wasStellar && tx.provider === PaymentProvider.STELLAR && tx.providerCode) {
      tx.status = TxStatus.PENDING;
      tx.failureReason = null;
      await this.txRepository.save(tx);
      try {
        return await this.applyTransfer(tx, await this.stellar!.retryTransfer(tx.providerCode));
      } catch (err) {
        return this.stellarError(tx, err);
      }
    }
    tx.txHash = null;
    tx.providerCode = null;
    tx.assetAmount = null;
    tx.fxRate = null;
    tx.destination = null;
    tx.destinationMemo = null;
    tx.status = TxStatus.PENDING;
    tx.failureReason = null;
    tx.reference = `${tx.reference.replace(/-[0-9A-F]{8}$/, '')}-${shortId()}`;
    await this.txRepository.save(tx);
    return this.execute(tx);
  }

  // ── Stellar (through stellar-payment-service) ──

  /**
   * Asks the service to send a Stellar payout or refund. The escrow reference is the service's
   * idempotency key, so calling this again (after a timeout, a restart, or from the reconciler)
   * returns the same transfer instead of paying twice. Final status arrives by webhook.
   */
  private async executeStellar(tx: EscrowTransaction): Promise<EscrowTransaction> {
    if (!this.stellar?.isConfigured) return this.fail(tx, 'Stellar payments are not configured (STELLAR_SERVICE_URL).');
    try {
      if (tx.type === TxType.REFUND) {
        const hold = await this.holdFor(tx);
        if (!hold || hold.provider !== PaymentProvider.STELLAR || !hold.providerCode) return this.fail(tx, 'No Stellar payment to refund.');
        return this.applyTransfer(
          tx,
          await this.stellar.createRefund({ clientReference: tx.reference, paymentId: hold.providerCode, share: { part: tx.amount, whole: hold.amount } }),
        );
      }
      const profile = await this.payeeProfile(tx);
      if (!profile?.stellarAddress) return this.fail(tx, 'The payee has no Stellar address. Ask them to add one or switch to bank payouts.');
      return this.applyTransfer(
        tx,
        await this.stellar.createPayout({
          clientReference: tx.reference,
          destination: profile.stellarAddress,
          nairaAmount: tx.amount,
          memo: profile.stellarMemo || tx.reference,
        }),
      );
    } catch (err) {
      return this.stellarError(tx, err);
    }
  }

  /** Copies the service's view of a transfer onto the escrow row. */
  private async applyTransfer(tx: EscrowTransaction, t: ServiceTransfer): Promise<EscrowTransaction> {
    tx.providerCode = t.id;
    tx.txHash = t.txHash;
    tx.assetAmount = t.amount;
    tx.fxRate = t.fxRate;
    tx.destination = t.destination;
    tx.destinationMemo = t.memo;
    if (t.status === 'failed') return this.fail(tx, t.failureReason ?? 'The Stellar transfer failed.');
    tx.status = t.status === 'success' ? TxStatus.SUCCESS : TxStatus.PENDING;
    tx.failureReason = null;
    return this.txRepository.save(tx);
  }

  /** A refusal (bad address, refund cap…) fails the row; an unreachable service leaves it pending for the reconciler. */
  private async stellarError(tx: EscrowTransaction, err: unknown): Promise<EscrowTransaction> {
    if (err instanceof StellarServiceError && err.isRejection) return this.fail(tx, err.message);
    this.logger.warn(`Stellar ${tx.reference}: ${(err as Error).message}. The reconciler will try again.`);
    tx.failureReason = 'Waiting for stellar-payment-service';
    return this.txRepository.save(tx);
  }

  /** `transfer.succeeded` / `transfer.failed` from the service. Ignores rows that are already final. */
  async onStellarTransferEvent(t: ServiceTransfer): Promise<void> {
    const tx = await this.txRepository.findOne({ where: { reference: t.clientReference, provider: PaymentProvider.STELLAR } });
    if (!tx || tx.status === TxStatus.SUCCESS) return;
    if (tx.status === TxStatus.FAILED && t.status === 'failed') return;
    await this.applyTransfer(tx, t);
  }

  /**
   * Stellar rows still pending after a few minutes: ask the service again. Creation is
   * idempotent on the reference, so this either returns the existing transfer's state or
   * creates it if the first request never arrived.
   */
  async reconcileStellar(now = new Date()): Promise<void> {
    if (!this.stellar?.isConfigured) return;
    const stale = await this.txRepository.find({
      where: { provider: PaymentProvider.STELLAR, status: TxStatus.PENDING, updatedAt: LessThan(new Date(now.getTime() - 2 * 60 * 1000)) },
      order: { createdAt: 'ASC' },
      take: 100,
    });
    for (const tx of stale) {
      if (tx.type === TxType.HOLD) continue;
      await this.executeStellar(tx);
    }
  }

  // ── Webhooks ──

  /** transfer.success / transfer.failed / transfer.reversed */
  async onTransferEvent(event: string, reference: string | undefined, reason?: string): Promise<void> {
    if (!reference) return;
    const tx = await this.txRepository.findOne({ where: { reference } });
    if (!tx) return;
    if (event === 'transfer.success') tx.status = TxStatus.SUCCESS;
    else if (event === 'transfer.failed') {
      tx.status = TxStatus.FAILED;
      tx.failureReason = reason || 'Transfer failed at Paystack';
    } else if (event === 'transfer.reversed') {
      tx.status = TxStatus.REVERSED;
      tx.failureReason = reason || 'Transfer reversed by Paystack';
    } else return;
    await this.txRepository.save(tx);
    if (tx.status !== TxStatus.SUCCESS) this.alertFailure(tx);
  }

  /** refund.processed / refund.failed — matched by Paystack's refund id, else the oldest pending refund on that payment. */
  async onRefundEvent(event: string, data: { id?: string | number; transaction_reference?: string }): Promise<void> {
    let tx = data.id ? await this.txRepository.findOne({ where: { type: TxType.REFUND, providerCode: String(data.id) } }) : null;
    if (!tx && data.transaction_reference) {
      const hold = await this.txRepository.findOne({ where: { reference: data.transaction_reference, type: TxType.HOLD } });
      if (hold) {
        tx = await this.txRepository.findOne({
          where: { orderId: hold.orderId, type: TxType.REFUND, status: TxStatus.PENDING },
          order: { createdAt: 'ASC' },
        });
      }
    }
    if (!tx) return;
    if (event === 'refund.processed') tx.status = TxStatus.SUCCESS;
    else if (event === 'refund.failed') {
      tx.status = TxStatus.FAILED;
      tx.failureReason = 'Refund failed at Paystack';
    } else return;
    await this.txRepository.save(tx);
    if (tx.status === TxStatus.FAILED) this.alertFailure(tx);
  }

  // ── Internals ──

  private async fail(tx: EscrowTransaction, reason: string): Promise<EscrowTransaction> {
    tx.status = TxStatus.FAILED;
    tx.failureReason = reason;
    const saved = await this.txRepository.save(tx);
    this.alertFailure(saved);
    return saved;
  }

  /** Money that should have moved didn't: an admin needs to fix the account or retry from /admin. */
  private alertFailure(tx: EscrowTransaction) {
    const what = tx.type === TxType.REFUND ? 'Refund' : `Payout to ${tx.partyType ?? 'party'}`;
    const usdc = tx.assetAmount ? ` / ${tx.assetAmount} USDC` : '';
    this.alerts?.notify({
      title: `${what} ${tx.status}: ₦${tx.amount.toLocaleString('en-NG')}${usdc} (${tx.reference})`,
      details: [
        `Reason: ${tx.failureReason ?? 'unknown'}`,
        `Provider: ${tx.provider ?? PaymentProvider.PAYSTACK}`,
        `Order: ${tx.orderId}`,
        `Transaction: ${tx.id}`,
        tx.txHash ? `Stellar tx: ${tx.txHash}` : null,
        'Retry it from the admin console once the cause is fixed.',
      ]
        .filter(Boolean)
        .join('\n'),
      signature: `escrow:${tx.id}:${tx.status}:${tx.reference}`,
    });
  }

  /** The HOLD a refund returns money from. */
  private holdFor(tx: EscrowTransaction): Promise<EscrowTransaction | null> {
    return tx.holdReference
      ? this.txRepository.findOne({ where: { reference: tx.holdReference, type: TxType.HOLD } })
      : this.txRepository.findOne({ where: { orderId: tx.orderId, type: TxType.HOLD, status: TxStatus.SUCCESS } });
  }

  /** Stellar when the payee chose it and Stellar payouts are on; otherwise the bank through Paystack. */
  private async payoutProvider(em: EntityManager, party: { type: 'tailor' | 'merchant'; id: string }): Promise<PaymentProvider> {
    if (!(await this.stellar?.payoutsEnabled())) return PaymentProvider.PAYSTACK;
    const entity = party.type === 'tailor' ? TailorProfile : MerchantProfile;
    const profile = (await em.findOne(entity, { where: { id: party.id } })) as TailorProfile | MerchantProfile | null;
    return profile?.payoutMethod === 'stellar' && profile.stellarAddress ? PaymentProvider.STELLAR : PaymentProvider.PAYSTACK;
  }

  private payeeProfile(tx: EscrowTransaction): Promise<TailorProfile | MerchantProfile | null> {
    return tx.partyType === 'tailor'
      ? this.dataSource.getRepository(TailorProfile).findOne({ where: { id: tx.partyId } })
      : this.dataSource.getRepository(MerchantProfile).findOne({ where: { id: tx.partyId } });
  }

  /** The payee's Paystack recipient code, creating and storing one on first payout. */
  private async recipientFor(tx: EscrowTransaction): Promise<string | null> {
    const repo =
      tx.partyType === 'tailor'
        ? this.dataSource.getRepository(TailorProfile)
        : this.dataSource.getRepository(MerchantProfile);
    const profile = (await repo.findOne({ where: { id: tx.partyId } })) as TailorProfile | MerchantProfile | null;
    if (!profile?.bankCode || !profile.accountNumber) return null;
    if (profile.paystackRecipientCode) return profile.paystackRecipientCode;

    const name =
      profile.accountName ||
      ('atelierName' in profile ? profile.atelierName : (profile as MerchantProfile).businessName) ||
      'AfroCouture payee';
    const code = await this.paystack.createRecipient({ name, accountNumber: profile.accountNumber, bankCode: profile.bankCode });
    await repo.update(profile.id, { paystackRecipientCode: code });
    return code;
  }
}

