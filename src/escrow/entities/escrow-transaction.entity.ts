import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum EscrowTransactionType {
  /** Customer's payment received and held by the platform. */
  HOLD = 'hold',
  /** Payout of workmanship + delivery to the tailor. */
  RELEASE_TAILOR = 'release_tailor',
  /** Payout of a merchant's fabric lines. */
  RELEASE_MERCHANT = 'release_merchant',
  /** Money returned to the customer (full or partial). */
  REFUND = 'refund',
}

/** How the money moves: Paystack (naira, card/bank) or USDC on Stellar. */
export enum PaymentProvider {
  PAYSTACK = 'paystack',
  STELLAR = 'stellar',
}

export enum EscrowTransactionStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  REVERSED = 'reversed',
}

/** Ledger of every naira movement (whatever the provider) for an order. The order's escrow balance is HOLD minus releases and refunds. */
@Entity('escrow_transactions')
@Index(['orderId'])
@Index(['status', 'type'])
export class EscrowTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  orderId: string;

  @Column({ type: 'enum', enum: EscrowTransactionType })
  type: EscrowTransactionType;

  @Column({ type: 'enum', enum: EscrowTransactionStatus, default: EscrowTransactionStatus.PENDING })
  status: EscrowTransactionStatus;

  /** Naira. */
  @Column({ type: 'int' })
  amount: number;

  /** 'customer' | 'tailor' | 'merchant' */
  @Column({ type: 'varchar' })
  partyType: string;

  /** User.id for customers, TailorProfile.id / MerchantProfile.id for payees. */
  @Column({ type: 'uuid' })
  partyId: string;

  /** Our unique reference (Paystack transaction/transfer reference, or a Stellar intent/payout reference). */
  @Index({ unique: true })
  @Column({ type: 'varchar' })
  reference: string;

  /** Paystack's transfer_code / refund id, or the Stellar transaction hash, once known. */
  @Column({ type: 'varchar', nullable: true })
  providerCode: string | null;

  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  // ── Provider details. `amount` stays whole naira for every provider. ──

  @Column({ type: 'varchar', length: 16, default: PaymentProvider.PAYSTACK })
  provider: PaymentProvider;

  /** Stellar: USDC that moved (or will move), 7 decimals, as a string. */
  @Column({ type: 'numeric', precision: 20, scale: 7, nullable: true })
  assetAmount: string | null;

  /** Stellar: naira per USDC used for this row. */
  @Column({ type: 'numeric', precision: 20, scale: 7, nullable: true })
  fxRate: string | null;

  /** Stellar: hash of the transaction (incoming for a HOLD, ours for payouts and refunds). */
  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  txHash: string | null;

  /** Stellar: our signed transaction can't land after this; until then a missing tx is still "pending". */
  @Column({ type: 'timestamptz', nullable: true })
  submittedUntil: Date | null;

  /**
   * Stellar: on a HOLD, where refunds go (the customer's refund address, else the payer);
   * on a payout or refund, the address it was sent to.
   */
  @Column({ type: 'varchar', length: 69, nullable: true })
  destination: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  destinationMemo: string | null;

  /** Refunds: the HOLD being refunded. Null on older rows (the order's first successful hold). */
  @Column({ type: 'varchar', nullable: true })
  holdReference: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
