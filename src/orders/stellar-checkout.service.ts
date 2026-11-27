import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull, LessThan } from 'typeorm';
import { StrKey } from '@stellar/stellar-sdk';
import { Order, OrderStatus } from './entities/order.entity.js';
import { StellarIntentStatus, StellarPaymentIntent } from './entities/stellar-payment-intent.entity.js';
import { OrdersService } from './orders.service.js';
import { PayDto } from './dto/order.dto.js';
import { EscrowService } from '../escrow/escrow.service.js';
import { PaymentProvider } from '../escrow/entities/escrow-transaction.entity.js';
import { IncomingPayment, MAX_TEXT_MEMO_BYTES, StellarError, StellarService, isValidMemo } from '../payments/stellar/stellar.service.js';
import { FxRateService } from '../payments/stellar/fx-rate.service.js';
import {
  applySpread,
  coversWithin,
  fromStroops,
  nairaToUsdcStroops,
  toStroops,
  usdcStroopsToNaira,
} from '../payments/stellar/money.js';
import {
  StellarUnmatchedDeposit,
  UnmatchedReason,
  UnmatchedStatus,
} from '../payments/stellar/entities/stellar-unmatched-deposit.entity.js';
import { AlertsService } from '../common/alerts/alerts.service.js';
import { User } from '../users/entities/user.entity.js';

const STALE_REFUND_CLAIM_MS = 5 * 60 * 1000;

/**
 * Paying for an order in USDC on Stellar: quotes (intents), matching incoming payments
 * to them, and the admin tools for payments that didn't match. Settlement goes through
 * OrdersService.applyPayment, the same path as Paystack.
 */
@Injectable()
export class StellarCheckoutService {
  private readonly logger = new Logger(StellarCheckoutService.name);
  private readonly treasuryAddress: string | null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly orders: OrdersService,
    private readonly escrow: EscrowService,
    private readonly stellar: StellarService,
    private readonly fx: FxRateService,
    config: ConfigService,
    @Optional() private readonly alerts?: AlertsService,
  ) {
    const treasury = config.get<string>('STELLAR_TREASURY_PUBLIC')?.trim();
    this.treasuryAddress = treasury && StrKey.isValidEd25519PublicKey(treasury) ? treasury : null;
  }

  // ───────────────────────── Customer ─────────────────────────

  /** Starts (or resumes) a USDC checkout for a quoted order. */
  async start(user: User, orderId: string, dto: PayDto) {
    this.stellar.assertCheckoutEnabled();
    if (!this.fx.isConfigured) throw new ServiceUnavailableException('Stellar payments are not available right now.');
    if (dto.refundMemo && !isValidMemo(dto.refundMemo)) {
      throw new BadRequestException('That memo is too long: use a number or at most 28 bytes of text.');
    }
    if (dto.refundMemo && !dto.refundAddress) throw new BadRequestException('Add the refund address that goes with the memo.');

    // Fetch the rate before taking the lock, so a slow FX feed doesn't hold the order row.
    const midRate = await this.fx.ngnPerUsdc();

    const intent = await this.dataSource.transaction(async (em) => {
      const order = await em.findOne(Order, { where: { id: orderId }, lock: { mode: 'pessimistic_write' } });
      if (!order || order.customerId !== user.id) throw new NotFoundException('Order not found.');
      if (order.status !== OrderStatus.QUOTED) throw new ConflictException(`This order is ${order.status}; you can't pay for it now.`);

      const repo = em.getRepository(StellarPaymentIntent);
      const latest = await repo.findOne({ where: { orderId }, order: { createdAt: 'DESC' } });
      const reusable =
        latest?.status === StellarIntentStatus.AWAITING && latest.expiresAt > new Date() && latest.nairaAmount === order.totalAmount;
      if (reusable) {
        if (dto.payerAddress) latest.payerAddress = dto.payerAddress;
        if (dto.refundAddress) {
          latest.refundAddress = dto.refundAddress;
          latest.refundMemo = dto.refundMemo?.trim() || null;
        }
        return repo.save(latest);
      }

      const fxRate = applySpread(midRate, this.stellar.spreadBps);
      const stroops = nairaToUsdcStroops(order.totalAmount, fxRate, 'up');
      const attempt = (await repo.count({ where: { orderId } })) + 1;
      const reference = `${order.reference}-S${attempt}`;
      if (Buffer.byteLength(reference) > MAX_TEXT_MEMO_BYTES) throw new ConflictException('Too many payment attempts on this order.');
      return repo.save(
        repo.create({
          orderId,
          reference,
          nairaAmount: order.totalAmount,
          usdcAmount: fromStroops(stroops),
          fxRate,
          expiresAt: new Date(Date.now() + this.stellar.quoteTtlMinutes * 60_000),
          status: StellarIntentStatus.AWAITING,
          payerAddress: dto.payerAddress ?? null,
          refundAddress: dto.refundAddress ?? null,
          refundMemo: dto.refundAddress ? dto.refundMemo?.trim() || null : null,
        }),
      );
    });
    return this.toView(intent);
  }

  /** The order's latest Stellar checkout, for the payment screen to poll. */
  async current(user: User, orderId: string) {
    const order = await this.dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    if (!order || order.customerId !== user.id) throw new NotFoundException('Order not found.');
    const intent = await this.dataSource
      .getRepository(StellarPaymentIntent)
      .findOne({ where: { orderId }, order: { createdAt: 'DESC' } });
    return { orderStatus: order.status, intent: intent ? this.toView(intent) : null };
  }

  private toView(intent: StellarPaymentIntent) {
    const amount = intent.usdcAmount;
    return {
      method: 'stellar' as const,
      id: intent.id,
      reference: intent.reference,
      status: intent.status,
      network: this.stellar.network,
      destination: this.stellar.operatingAddress,
      memo: intent.reference,
      memoType: 'text' as const,
      asset: { code: 'USDC', issuer: this.stellar.usdc?.getIssuer() ?? null },
      amount,
      nairaAmount: intent.nairaAmount,
      expiresAt: intent.expiresAt,
      payerAddress: intent.payerAddress,
      refundAddress: intent.refundAddress,
      refundMemo: intent.refundMemo,
      txHash: intent.txHash,
      explorerUrl: intent.txHash ? this.stellar.explorerUrl(intent.txHash) : null,
      sep7Uri: this.stellar.payUri({ amount: amount.replace(/\.?0+$/, ''), memo: intent.reference }),
    };
  }

  // ───────────────────────── Incoming payments ─────────────────────────

  /** Matches one payment into the operating account to a checkout, or records it as unmatched. Idempotent. */
  async handleIncoming(payment: IncomingPayment): Promise<void> {
    if (!payment.successful || payment.to !== this.stellar.operatingAddress) return;
    if (payment.from === this.stellar.operatingAddress) return;
    // Top-ups from our own Treasury are not customer payments.
    if (this.treasuryAddress && payment.from === this.treasuryAddress) return;

    if (!this.stellar.isUsdc(payment.assetCode, payment.assetIssuer)) {
      await this.recordUnmatched(payment, UnmatchedReason.WRONG_ASSET);
      return;
    }
    const memo = payment.memoType === 'text' ? payment.memo?.trim().toUpperCase() : null;
    if (!memo) {
      await this.recordUnmatched(payment, UnmatchedReason.NO_MEMO);
      return;
    }
    const intent = await this.dataSource.getRepository(StellarPaymentIntent).findOne({ where: { reference: memo } });
    if (!intent) {
      await this.recordUnmatched(payment, UnmatchedReason.UNKNOWN_MEMO);
      return;
    }
    await this.settle(intent, payment);
  }

  /**
   * Applies a USDC payment to its intent. On time: it must be at least the quoted amount.
   * Late: it must cover the price at today's rate within STELLAR_LATE_TOLERANCE_BPS.
   * Overpaid beyond STELLAR_OVERPAY_REFUND_BPS: the extra is refunded.
   */
  async settle(intent: StellarPaymentIntent, payment: IncomingPayment): Promise<'paid' | 'refunded' | 'duplicate'> {
    const received = toStroops(payment.amount);
    const onTime = payment.createdAt <= intent.expiresAt;
    let rate = intent.fxRate;
    let due = toStroops(intent.usdcAmount);
    if (!onTime) {
      rate = applySpread(await this.fx.ngnPerUsdc(), this.stellar.spreadBps);
      due = nairaToUsdcStroops(intent.nairaAmount, rate, 'up');
    }
    const pays = onTime ? received >= due : coversWithin(received, due, this.stellar.lateToleranceBps);
    const overpaid = received * 10_000n > due * (10_000n + BigInt(this.stellar.overpayRefundBps));

    const refundTo = intent.refundAddress ?? payment.from;
    const refundMemo = intent.refundAddress ? intent.refundMemo : null;
    const { outcome } = await this.orders.applyPayment({
      orderId: intent.orderId,
      holdReference: `${intent.reference}-OP${payment.id}`,
      paidNaira: usdcStroopsToNaira(received, intent.fxRate),
      covers: (order) => pays && order.totalAmount === intent.nairaAmount,
      coveredHoldNaira: (order) => (overpaid ? usdcStroopsToNaira(received, rate) : order.totalAmount),
      hold: {
        provider: PaymentProvider.STELLAR,
        assetAmount: fromStroops(received),
        fxRate: rate,
        txHash: payment.txHash,
        destination: refundTo,
        destinationMemo: refundMemo,
      },
      method: 'stellar',
      actorUserId: null,
    });

    if (outcome !== 'duplicate') {
      const repo = this.dataSource.getRepository(StellarPaymentIntent);
      const fresh = await repo.findOne({ where: { id: intent.id } });
      if (fresh && fresh.status !== StellarIntentStatus.PAID) {
        fresh.status = outcome === 'paid' ? StellarIntentStatus.PAID : StellarIntentStatus.REJECTED;
        fresh.txHash = payment.txHash;
        fresh.payerAddress ??= payment.from;
        await repo.save(fresh);
      }
      this.logger.log(`Stellar payment ${payment.txHash} for ${intent.reference}: ${outcome}`);
    }
    return outcome;
  }

  /** Marks quotes that ran out as expired (a late payment can still settle them). */
  async expireIntents(now = new Date()): Promise<number> {
    const result = await this.dataSource
      .getRepository(StellarPaymentIntent)
      .update({ status: StellarIntentStatus.AWAITING, expiresAt: LessThan(now) }, { status: StellarIntentStatus.EXPIRED });
    return result.affected ?? 0;
  }

  private async recordUnmatched(payment: IncomingPayment, reason: UnmatchedReason) {
    const repo = this.dataSource.getRepository(StellarUnmatchedDeposit);
    const inserted = await repo
      .createQueryBuilder()
      .insert()
      .values({
        operationId: payment.id,
        txHash: payment.txHash,
        fromAddress: payment.from,
        amount: payment.amount,
        assetCode: payment.assetCode,
        assetIssuer: payment.assetIssuer,
        memo: payment.memo,
        reason,
        status: UnmatchedStatus.OPEN,
        receivedAt: payment.createdAt,
      })
      .orIgnore()
      .execute();
    if (!(inserted.raw as unknown[]).length) return; // seen before (ON CONFLICT DO NOTHING)
    this.alerts?.notify({
      title: `Unmatched Stellar deposit: ${payment.amount} ${payment.assetCode ?? 'XLM'} (${reason})`,
      details: [
        `From: ${payment.from}`,
        `Memo: ${payment.memo ?? '(none)'}`,
        `Transaction: ${this.stellar.explorerUrl(payment.txHash)}`,
        'Attach it to an order or refund it from Admin → Stellar.',
      ].join('\n'),
      signature: `stellar-unmatched:${payment.id}`,
    });
  }

  // ───────────────────────── Admin ─────────────────────────

  listUnmatched(status: UnmatchedStatus | 'all') {
    const repo = this.dataSource.getRepository(StellarUnmatchedDeposit);
    return repo.find({
      where: status === 'all' ? {} : { status },
      order: { receivedAt: 'DESC' },
      take: 500,
    });
  }

  /** Settles an unmatched USDC deposit against an order's latest Stellar checkout. */
  async attachUnmatched(admin: User, depositId: string, orderReference: string) {
    const repo = this.dataSource.getRepository(StellarUnmatchedDeposit);
    const deposit = await repo.findOne({ where: { id: depositId } });
    if (!deposit) throw new NotFoundException('Deposit not found.');
    if (deposit.status !== UnmatchedStatus.OPEN) throw new ConflictException(`This deposit is ${deposit.status.replace('_', ' ')}.`);
    if (!this.stellar.isUsdc(deposit.assetCode, deposit.assetIssuer)) {
      throw new BadRequestException('Only USDC deposits can be attached to an order.');
    }
    const order = await this.dataSource.getRepository(Order).findOne({ where: { reference: orderReference.trim().toUpperCase() } });
    if (!order) throw new NotFoundException('No order has that reference.');
    const intent = await this.dataSource
      .getRepository(StellarPaymentIntent)
      .findOne({ where: { orderId: order.id }, order: { createdAt: 'DESC' } });
    if (!intent) throw new BadRequestException("The customer hasn't started a Stellar checkout for this order, so there's no quoted amount to check against.");

    const outcome = await this.settle(intent, {
      id: deposit.operationId,
      pagingToken: '',
      txHash: deposit.txHash,
      successful: true,
      from: deposit.fromAddress,
      to: this.stellar.operatingAddress!,
      assetCode: deposit.assetCode,
      assetIssuer: deposit.assetIssuer,
      amount: deposit.amount,
      memo: deposit.memo,
      memoType: 'text',
      createdAt: deposit.receivedAt,
    });
    deposit.status = UnmatchedStatus.ATTACHED;
    deposit.orderId = order.id;
    deposit.resolvedByUserId = admin.id;
    deposit.note = `Attached to ${order.reference}: ${outcome === 'paid' ? 'order paid' : outcome === 'refunded' ? "didn't cover the order, refund started" : 'already applied'}`;
    return { deposit: await repo.save(deposit), outcome };
  }

  /** Sends an unmatched USDC deposit back. Exchanges need the memo, so the admin gives the address and memo. */
  async refundUnmatched(admin: User, depositId: string, input: { address: string; memo?: string }) {
    const address = input.address.trim().toUpperCase();
    const memo = input.memo?.trim() || null;
    if (!StrKey.isValidEd25519PublicKey(address)) throw new BadRequestException('Enter a valid Stellar address.');
    if (memo && !isValidMemo(memo)) throw new BadRequestException('That memo is too long: use a number or at most 28 bytes of text.');
    if (!this.stellar.canSign) throw new ServiceUnavailableException('Stellar signing is not configured (STELLAR_OPERATING_SECRET).');

    const repo = this.dataSource.getRepository(StellarUnmatchedDeposit);
    const deposit = await repo.findOne({ where: { id: depositId } });
    if (!deposit) throw new NotFoundException('Deposit not found.');
    if (!this.stellar.isUsdc(deposit.assetCode, deposit.assetIssuer)) {
      throw new BadRequestException('Only USDC can be refunded from here. Return other assets by hand and dismiss the deposit.');
    }
    // Claim it: only one refund can ever be in flight for a deposit.
    const claimed = await repo.update(
      { id: depositId, status: In([UnmatchedStatus.OPEN, UnmatchedStatus.REFUND_FAILED]) },
      { status: UnmatchedStatus.REFUND_PENDING, refundAddress: address, refundMemo: memo, refundTxHash: null, refundSubmittedUntil: null, resolvedByUserId: admin.id },
    );
    if (!claimed.affected) throw new ConflictException(`This deposit is ${deposit.status.replace('_', ' ')}.`);

    return this.stellar.withSubmitLock(async () => {
      let signed;
      try {
        signed = await this.stellar.signPayment({ to: address, stroops: toStroops(deposit.amount), memo });
      } catch (err) {
        const reason = err instanceof StellarError ? err.message : 'Could not build the refund';
        await repo.update({ id: depositId }, { status: UnmatchedStatus.REFUND_FAILED, note: reason });
        return repo.findOne({ where: { id: depositId } });
      }
      await repo.update({ id: depositId }, { refundTxHash: signed.hash, refundSubmittedUntil: signed.maxTime });
      const result = await this.stellar.submit(signed.xdr);
      if (result.status === 'success') await repo.update({ id: depositId }, { status: UnmatchedStatus.REFUNDED, note: null });
      else if (result.status === 'failed') await repo.update({ id: depositId }, { status: UnmatchedStatus.REFUND_FAILED, note: result.reason });
      return repo.findOne({ where: { id: depositId } });
    });
  }

  async dismissUnmatched(admin: User, depositId: string, note: string) {
    const repo = this.dataSource.getRepository(StellarUnmatchedDeposit);
    const claimed = await repo.update(
      { id: depositId, status: In([UnmatchedStatus.OPEN, UnmatchedStatus.REFUND_FAILED]) },
      { status: UnmatchedStatus.DISMISSED, note: note.trim(), resolvedByUserId: admin.id },
    );
    if (!claimed.affected) throw new ConflictException('Only open or failed deposits can be dismissed.');
    return repo.findOne({ where: { id: depositId } });
  }

  /** Confirms or fails unmatched-deposit refunds left pending, like EscrowService.reconcileStellar. */
  async reconcileUnmatchedRefunds(now = new Date()): Promise<void> {
    const repo = this.dataSource.getRepository(StellarUnmatchedDeposit);
    const pending = await repo.find({ where: { status: UnmatchedStatus.REFUND_PENDING }, take: 100 });
    let ledgerTime: Date | null = null;
    for (const d of pending) {
      try {
        if (!d.refundTxHash) {
          // Claimed but never signed: nothing was sent.
          if (now.getTime() - d.updatedAt.getTime() > STALE_REFUND_CLAIM_MS) {
            await repo.update({ id: d.id, refundTxHash: IsNull(), status: UnmatchedStatus.REFUND_PENDING }, {
              status: UnmatchedStatus.REFUND_FAILED,
              note: 'The refund was interrupted before it was sent. Safe to retry.',
            });
          }
          continue;
        }
        const status = await this.stellar.transactionStatus(d.refundTxHash);
        if (status === 'success') await repo.update({ id: d.id }, { status: UnmatchedStatus.REFUNDED, note: null });
        else if (status === 'failed') await repo.update({ id: d.id }, { status: UnmatchedStatus.REFUND_FAILED, note: 'The refund failed on the Stellar network.' });
        else if (d.refundSubmittedUntil) {
          ledgerTime ??= await this.stellar.latestLedgerCloseTime();
          if (ledgerTime > d.refundSubmittedUntil) {
            await repo.update({ id: d.id }, { status: UnmatchedStatus.REFUND_FAILED, note: 'Not confirmed before it expired, so it was never sent. Safe to retry.' });
          }
        }
      } catch (err) {
        this.logger.warn(`Reconciling unmatched refund ${d.id} failed: ${(err as Error).message}`);
      }
    }
  }

  /** Operating balances against what pending payouts need, for the admin treasury panel and alerts. */
  async treasury() {
    if (!this.stellar.isConfigured) {
      return { configured: false as const, checkoutEnabled: false, payoutsEnabled: false };
    }
    const [balances, pending, openUnmatched] = await Promise.all([
      this.stellar.operatingBalances().catch(() => null),
      this.escrow.pendingStellarStroops(),
      this.dataSource.getRepository(StellarUnmatchedDeposit).count({
        where: { status: In([UnmatchedStatus.OPEN, UnmatchedStatus.REFUND_FAILED]) },
      }),
    ]);
    const warnings: string[] = [];
    if (!balances) warnings.push('Could not read the operating account from Horizon.');
    else {
      if (balances.xlm < this.stellar.minXlm) warnings.push(`XLM for fees is low (${fromStroops(balances.xlm)}). Top up from Treasury.`);
      if (balances.usdc < pending) warnings.push(`USDC (${fromStroops(balances.usdc)}) is less than pending payouts need (${fromStroops(pending)}).`);
      if (this.stellar.floatMaxUsdc !== null && balances.usdc > this.stellar.floatMaxUsdc) {
        warnings.push(`USDC float (${fromStroops(balances.usdc)}) is above STELLAR_FLOAT_MAX_USDC. Sweep the extra to Treasury.`);
      }
    }
    if (openUnmatched) warnings.push(`${openUnmatched} unmatched deposit(s) need attention.`);
    return {
      configured: true as const,
      network: this.stellar.network,
      checkoutEnabled: this.stellar.checkoutEnabled,
      payoutsEnabled: this.stellar.payoutsEnabled,
      canSign: this.stellar.canSign,
      operatingAddress: this.stellar.operatingAddress,
      usdc: balances ? fromStroops(balances.usdc) : null,
      xlm: balances ? fromStroops(balances.xlm) : null,
      pendingPayoutsUsdc: fromStroops(pending),
      floatMaxUsdc: this.stellar.floatMaxUsdc !== null ? fromStroops(this.stellar.floatMaxUsdc) : null,
      minXlm: fromStroops(this.stellar.minXlm),
      openUnmatched,
      warnings,
    };
  }
}
