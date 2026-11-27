import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum StellarIntentStatus {
  /** Waiting for the customer's USDC. */
  AWAITING = 'awaiting',
  /** Settled: the order was paid with this intent. */
  PAID = 'paid',
  /** The quote ran out before any payment arrived (a late payment can still settle it). */
  EXPIRED = 'expired',
  /** A payment arrived but didn't match (short, late and short, or the order had moved on); it is refunded. */
  REJECTED = 'rejected',
}

/**
 * One Stellar checkout attempt, the equivalent of a Paystack reference: a USDC amount
 * locked at a naira rate until `expiresAt`. `reference` is also the memo the customer sends.
 */
@Entity('stellar_payment_intents')
@Index(['status', 'expiresAt'])
export class StellarPaymentIntent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  orderId: string;

  /** `${order.reference}-S${n}`, sent as the text memo (at most 28 bytes). */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 28 })
  reference: string;

  /** order.totalAmount when the quote was made. */
  @Column({ type: 'int' })
  nairaAmount: number;

  /** USDC the customer must send, 7 decimals. */
  @Column({ type: 'numeric', precision: 20, scale: 7 })
  usdcAmount: string;

  /** Naira per USDC quoted, spread included. */
  @Column({ type: 'numeric', precision: 20, scale: 7 })
  fxRate: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'varchar', length: 16, default: StellarIntentStatus.AWAITING })
  status: StellarIntentStatus;

  /** Wallet the customer connected, if any. */
  @Column({ type: 'varchar', length: 56, nullable: true })
  payerAddress: string | null;

  /** Where to refund when paying from an exchange (its deposit address and memo). */
  @Column({ type: 'varchar', length: 56, nullable: true })
  refundAddress: string | null;

  @Column({ type: 'varchar', length: 28, nullable: true })
  refundMemo: string | null;

  /** The incoming transaction that settled (or was rejected against) this intent. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  txHash: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
