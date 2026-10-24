import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { randomBytes } from 'node:crypto';
import {
  EscrowTransaction,
  EscrowTransactionStatus as TxStatus,
  EscrowTransactionType as TxType,
} from './entities/escrow-transaction.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import { TailorProfile } from '../tailors/entities/tailor-profile.entity.js';
import { MerchantProfile } from '../merchants/entities/merchant-profile.entity.js';
import { PaystackError, PaystackService } from '../payments/paystack.service.js';

export interface EscrowSummary {
  held: number;
  released: number;
  refunded: number;
  balance: number;
}

/** Releases and refunds that count against the balance (a failed or reversed one gave the money back). */
const COMMITTED = [TxStatus.PENDING, TxStatus.SUCCESS];
const RELEASES = [TxType.RELEASE_TAILOR, TxType.RELEASE_MERCHANT];

const shortId = () => randomBytes(4).toString('hex').toUpperCase();

/**
 * The ledger behind every order: one HOLD when the customer pays, then payouts to
 * the tailor and merchants and any refunds. Money only moves through this service.
 */
@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(EscrowTransaction) private readonly txRepository: Repository<EscrowTransaction>,
    private readonly paystack: PaystackService,
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

  listByStatus(status: TxStatus): Promise<EscrowTransaction[]> {
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
  async recordHold(em: EntityManager, order: Order, reference: string, amount: number): Promise<void> {
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
      }),
    );
  }

  /** Commits a refund inside the caller's locked transaction; call `execute()` after commit. */
  async reserveRefund(em: EntityManager, order: Order, amount: number): Promise<EscrowTransaction | null> {
    const { balance } = await this.summary(order.id, em);
    const refundable = Math.min(amount, balance);
    if (refundable <= 0) return null;
    return em.save(
      em.create(EscrowTransaction, {
        orderId: order.id,
        type: TxType.REFUND,
        status: TxStatus.PENDING,
        amount: refundable,
        partyType: 'customer',
        partyId: order.customerId,
        reference: `${order.reference}-R-${shortId()}`,
      }),
    );
  }

  /**
   * Sends a reserved payout or refund to Paystack. Never throws: failures are stored
   * on the transaction for an admin to retry.
   */
  async execute(tx: EscrowTransaction): Promise<EscrowTransaction> {
    try {
      if (tx.type === TxType.REFUND) {
        const hold = await this.txRepository.findOne({
          where: { orderId: tx.orderId, type: TxType.HOLD, status: TxStatus.SUCCESS },
        });
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

    tx.status = TxStatus.PENDING;
    tx.failureReason = null;
    tx.reference = `${tx.reference.replace(/-[0-9A-F]{8}$/, '')}-${shortId()}`;
    await this.txRepository.save(tx);
    return this.execute(tx);
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
  }

  // ── Internals ──

  private async fail(tx: EscrowTransaction, reason: string): Promise<EscrowTransaction> {
    tx.status = TxStatus.FAILED;
    tx.failureReason = reason;
    return this.txRepository.save(tx);
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
