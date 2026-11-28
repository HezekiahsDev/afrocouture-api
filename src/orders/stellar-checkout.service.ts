import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Like } from 'typeorm';
import { Order, OrderStatus } from './entities/order.entity.js';
import { OrdersService } from './orders.service.js';
import { PayDto } from './dto/order.dto.js';
import { EscrowService } from '../escrow/escrow.service.js';
import { EscrowTransaction, EscrowTransactionType, PaymentProvider } from '../escrow/entities/escrow-transaction.entity.js';
import {
  ServiceDeposit,
  ServiceIntent,
  ServicePayment,
  StellarPaymentsClient,
  StellarServiceError,
  toHttpError,
} from '../payments/stellar/stellar-payments.client.js';
import { AlertsService } from '../common/alerts/alerts.service.js';
import { User } from '../users/entities/user.entity.js';

/** Data of a `payment.received` event (see stellar-payment-service docs/integration.md). */
export interface PaymentReceived {
  paymentId: string;
  intentReference: string;
  clientReference: string;
  quotedNairaAmount: number;
  amount: string;
  fxRate: string;
  onTime: boolean;
  coversQuote: boolean;
  overpaid: boolean;
  nairaValue: number;
  txHash: string;
}

export interface ServiceEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

/**
 * Paying for orders in USDC through stellar-payment-service. The service quotes, watches the
 * network and reports each payment's facts; this class decides what they mean for the order,
 * through OrdersService.applyPayment, the same path Paystack payments take.
 */
@Injectable()
export class StellarCheckoutService implements OnModuleInit {
  private readonly logger = new Logger(StellarCheckoutService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly orders: OrdersService,
    private readonly escrow: EscrowService,
    private readonly client: StellarPaymentsClient,
    private readonly scheduler: SchedulerRegistry,
    @Optional() private readonly alerts?: AlertsService,
  ) {}

  /** Every minute: re-ask the service about Stellar payouts/refunds still pending here. */
  onModuleInit() {
    if (!this.client.isConfigured || process.env.NODE_ENV === 'test') return;
    const timer = setInterval(() => {
      this.escrow.reconcileStellar().catch((err: unknown) => this.logger.warn(`Stellar reconcile failed: ${(err as Error).message}`));
    }, 60_000);
    timer.unref?.();
    this.scheduler.addInterval('stellar-escrow-reconcile', timer);
  }

  // ───────────────────────── Customer ─────────────────────────

  async start(user: User, orderId: string, dto: PayDto) {
    if (!(await this.client.checkoutEnabled())) throw new ServiceUnavailableException('Stellar payments are not available right now.');
    if (dto.refundMemo && !dto.refundAddress) throw new BadRequestException('Add the refund address that goes with the memo.');
    const order = await this.dataSource.getRepository(Order).findOneBy({ id: orderId });
    if (!order || order.customerId !== user.id) throw new NotFoundException('Order not found.');
    if (order.status !== OrderStatus.QUOTED) throw new ConflictException(`This order is ${order.status}; you can't pay for it now.`);
    try {
      const intent = await this.client.createIntent({
        clientReference: order.reference,
        nairaAmount: order.totalAmount,
        payerAddress: dto.payerAddress,
        refundAddress: dto.refundAddress,
        refundMemo: dto.refundMemo?.trim() || undefined,
        metadata: { orderId: order.id },
      });
      return this.toView(intent, [], order);
    } catch (err) {
      toHttpError(err, 'Could not start the USDC payment. Please try again.');
    }
  }

  /** The order's latest Stellar checkout, for the payment screen to poll. */
  async current(user: User, orderId: string) {
    const order = await this.dataSource.getRepository(Order).findOneBy({ id: orderId });
    if (!order || order.customerId !== user.id) throw new NotFoundException('Order not found.');
    if (!this.client.isConfigured) return { orderStatus: order.status, intent: null };
    try {
      const [latest] = await this.client.listIntents(order.reference);
      if (!latest) return { orderStatus: order.status, intent: null };
      const full = latest.status === 'received' ? await this.client.getIntent(latest.id) : { ...latest, payments: [] };
      return { orderStatus: order.status, intent: await this.toView(full, full.payments, order) };
    } catch (err) {
      toHttpError(err);
    }
  }

  /** The web app's StellarIntent shape (unchanged from the in-process version). */
  private async toView(intent: ServiceIntent, payments: ServicePayment[], order: Order) {
    const last = payments.at(-1) ?? null;
    return {
      method: 'stellar' as const,
      id: intent.id,
      reference: intent.reference,
      status: await this.viewStatus(intent, order),
      network: intent.network,
      destination: intent.destination,
      memo: intent.memo,
      memoType: intent.memoType,
      asset: intent.asset,
      amount: intent.amount,
      nairaAmount: intent.nairaAmount,
      expiresAt: intent.expiresAt,
      payerAddress: intent.payerAddress,
      refundAddress: intent.refundAddress,
      refundMemo: intent.refundMemo,
      txHash: last?.txHash ?? null,
      explorerUrl: last ? this.client.explorerUrl(last.txHash, intent.network) : null,
      sep7Uri: intent.sep7Uri,
    };
  }

  /**
   * 'paid' once a hold from this intent funds the order; 'rejected' once a hold from it was
   * fully refunded; 'awaiting' while the payment is still being processed here.
   */
  private async viewStatus(intent: ServiceIntent, order: Order): Promise<'awaiting' | 'paid' | 'expired' | 'rejected'> {
    if (intent.status === 'awaiting') return 'awaiting';
    const repo = this.dataSource.getRepository(EscrowTransaction);
    const holds = await repo.find({ where: { orderId: order.id, type: EscrowTransactionType.HOLD, reference: Like(`${intent.reference}-%`) } });
    if (!holds.length) return intent.status === 'expired' ? 'expired' : 'awaiting';
    for (const hold of holds) {
      const refunds = await repo.find({ where: { type: EscrowTransactionType.REFUND, holdReference: hold.reference } });
      if (refunds.reduce((s, r) => s + r.amount, 0) < hold.amount) return 'paid';
    }
    return 'rejected';
  }

  // ───────────────────────── Webhooks ─────────────────────────

  /** Handles one verified event from the service. Idempotent; throws to make the service retry. */
  async handleEvent(event: ServiceEvent): Promise<void> {
    switch (event.type) {
      case 'payment.received':
        await this.settle(event.data as unknown as PaymentReceived);
        return;
      case 'transfer.succeeded':
      case 'transfer.failed':
        await this.escrow.onStellarTransferEvent(event.data as never);
        return;
      case 'deposit.unmatched': {
        const d = event.data as { amount?: string; assetCode?: string | null; reason?: string; from?: string; memo?: string | null; explorerUrl?: string };
        this.alerts?.notify({
          title: `Unmatched Stellar deposit: ${d.amount} ${d.assetCode ?? 'XLM'} (${d.reason})`,
          details: [`From: ${d.from}`, `Memo: ${d.memo ?? '(none)'}`, `Transaction: ${d.explorerUrl}`, 'Attach it to an order or refund it from Admin → Stellar.'].join('\n'),
          signature: `stellar-unmatched:${event.id}`,
        });
        return;
      }
      case 'treasury.warning':
        this.alerts?.notify({
          title: 'Stellar treasury needs attention',
          details: ((event.data.warnings as string[]) ?? []).join('\n'),
          signature: `stellar-treasury:${((event.data.warnings as string[]) ?? []).join('|')}`,
        });
        return;
      default:
        return; // intent.expired and future types need nothing here
    }
  }

  /** Applies a payment's facts to its order. */
  async settle(p: PaymentReceived): Promise<'paid' | 'refunded' | 'duplicate'> {
    const order = await this.dataSource.getRepository(Order).findOneBy({ reference: p.clientReference });
    if (!order) {
      this.logger.error(`Stellar payment ${p.paymentId} names unknown order ${p.clientReference}`);
      this.alerts?.notify({ title: `Stellar payment for unknown order ${p.clientReference}`, details: `Payment ${p.paymentId}, tx ${p.txHash}`, signature: `stellar-unknown-order:${p.paymentId}` });
      return 'duplicate';
    }
    const { outcome } = await this.orders.applyPayment({
      orderId: order.id,
      holdReference: `${p.intentReference}-${p.paymentId}`,
      paidNaira: p.nairaValue,
      covers: (o) => p.coversQuote && o.totalAmount === p.quotedNairaAmount,
      coveredHoldNaira: (o) => (p.overpaid ? Math.max(p.nairaValue, o.totalAmount) : o.totalAmount),
      hold: { provider: PaymentProvider.STELLAR, assetAmount: p.amount, fxRate: p.fxRate, txHash: p.txHash, providerCode: p.paymentId },
      method: 'stellar',
      actorUserId: null,
    });
    if (outcome !== 'duplicate') this.logger.log(`Stellar payment ${p.txHash} for ${p.intentReference}: ${outcome}`);
    return outcome;
  }

  // ───────────────────────── Admin ─────────────────────────

  async listUnmatched(status: string) {
    // The console's filters map onto the service's: refund problems now show as transfer failures in Payouts.
    const serviceStatus = status === 'refund_failed' ? 'refunded' : status;
    try {
      return (await this.client.listDeposits(serviceStatus)).map((d) => this.depositView(d));
    } catch (err) {
      toHttpError(err);
    }
  }

  async attachUnmatched(_admin: User, depositId: string, orderReference: string) {
    const order = await this.dataSource.getRepository(Order).findOneBy({ reference: orderReference.trim().toUpperCase() });
    if (!order) throw new NotFoundException('No order has that reference.');
    try {
      const [intent] = await this.client.listIntents(order.reference);
      if (!intent) throw new BadRequestException("The customer hasn't started a Stellar checkout for this order, so there's no quoted amount to check against.");
      const { deposit, payment } = await this.client.attachDeposit(depositId, intent.reference);
      // Settle now rather than waiting for the webhook (which then finds it already applied).
      const outcome = await this.settle({
        paymentId: payment.id,
        intentReference: intent.reference,
        clientReference: order.reference,
        quotedNairaAmount: intent.nairaAmount,
        amount: payment.amount,
        fxRate: payment.fxRate,
        onTime: payment.onTime,
        coversQuote: payment.coversQuote,
        overpaid: payment.overpaid,
        nairaValue: payment.nairaValue,
        txHash: payment.txHash,
      });
      return { deposit: { ...this.depositView(deposit), orderId: order.id }, outcome };
    } catch (err) {
      if (err instanceof StellarServiceError) toHttpError(err);
      throw err;
    }
  }

  async refundUnmatched(_admin: User, depositId: string, input: { address: string; memo?: string }) {
    try {
      const { deposit, transfer } = await this.client.refundDeposit(depositId, {
        clientReference: `DEP-${depositId}`,
        destination: input.address.trim().toUpperCase(),
        memo: input.memo?.trim() || undefined,
      });
      const view = this.depositView(deposit);
      return {
        ...view,
        status: transfer.status === 'success' ? 'refunded' : transfer.status === 'pending' ? 'refund_pending' : 'refund_failed',
        refundAddress: transfer.destination,
        refundMemo: transfer.memo,
        refundTxHash: transfer.txHash,
        note: transfer.failureReason ?? view.note,
      };
    } catch (err) {
      toHttpError(err);
    }
  }

  async dismissUnmatched(_admin: User, depositId: string, note: string) {
    try {
      return this.depositView(await this.client.dismissDeposit(depositId, note));
    } catch (err) {
      toHttpError(err);
    }
  }

  /** The admin treasury panel (shape unchanged for the web app). */
  async treasury() {
    if (!this.client.isConfigured) return { configured: false as const, checkoutEnabled: false, payoutsEnabled: false };
    try {
      const t = (await this.client.treasury()) as Record<string, unknown>;
      if (!t.configured) return { configured: false as const, checkoutEnabled: false, payoutsEnabled: false };
      return {
        configured: true as const,
        network: t.network,
        checkoutEnabled: t.checkoutEnabled,
        payoutsEnabled: t.payoutsEnabled,
        canSign: t.canSign,
        operatingAddress: t.operatingAddress,
        usdc: t.usdc,
        xlm: t.xlm,
        pendingPayoutsUsdc: t.pendingTransfersUsdc,
        floatMaxUsdc: t.floatMaxUsdc,
        minXlm: t.minXlm,
        openUnmatched: t.openDeposits,
        warnings: t.warnings,
      };
    } catch (err) {
      toHttpError(err);
    }
  }

  private depositView(d: ServiceDeposit) {
    return {
      id: d.id,
      operationId: d.operationId,
      txHash: d.txHash,
      fromAddress: d.fromAddress,
      amount: d.amount,
      assetCode: d.assetCode,
      assetIssuer: d.assetIssuer,
      memo: d.memo,
      reason: d.reason,
      status: d.status,
      orderId: null as string | null,
      refundAddress: null as string | null,
      refundMemo: null as string | null,
      refundTxHash: null as string | null,
      note: d.note,
      receivedAt: d.receivedAt,
      updatedAt: d.updatedAt,
    };
  }
}
