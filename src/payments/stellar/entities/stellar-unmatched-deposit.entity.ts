import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum UnmatchedReason {
  NO_MEMO = 'no_memo',
  UNKNOWN_MEMO = 'unknown_memo',
  WRONG_ASSET = 'wrong_asset',
}

export enum UnmatchedStatus {
  OPEN = 'open',
  /** An admin attached it to an order; it went through normal settlement. */
  ATTACHED = 'attached',
  /** Refund signed and submitted; the reconciler confirms it. */
  REFUND_PENDING = 'refund_pending',
  REFUNDED = 'refunded',
  /** Refund didn't land; the admin can try again. */
  REFUND_FAILED = 'refund_failed',
  /** Handled outside the app (e.g. a non-USDC asset returned by hand). */
  DISMISSED = 'dismissed',
}

/** A payment into the operating account that we couldn't tie to a checkout. Admins attach or refund it. */
@Entity('stellar_unmatched_deposits')
@Index(['status'])
export class StellarUnmatchedDeposit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Horizon operation id: one row per incoming payment operation. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 40 })
  operationId: string;

  @Column({ type: 'varchar', length: 64 })
  txHash: string;

  @Column({ type: 'varchar', length: 56 })
  fromAddress: string;

  @Column({ type: 'numeric', precision: 20, scale: 7 })
  amount: string;

  /** null for XLM. */
  @Column({ type: 'varchar', length: 12, nullable: true })
  assetCode: string | null;

  @Column({ type: 'varchar', length: 56, nullable: true })
  assetIssuer: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  memo: string | null;

  @Column({ type: 'varchar', length: 16 })
  reason: UnmatchedReason;

  @Column({ type: 'varchar', length: 16, default: UnmatchedStatus.OPEN })
  status: UnmatchedStatus;

  /** Set when attached to an order. */
  @Column({ type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ type: 'varchar', length: 56, nullable: true })
  refundAddress: string | null;

  @Column({ type: 'varchar', length: 28, nullable: true })
  refundMemo: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  refundTxHash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  refundSubmittedUntil: Date | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'uuid', nullable: true })
  resolvedByUserId: string | null;

  @Column({ type: 'timestamptz' })
  receivedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
