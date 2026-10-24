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

export enum EscrowTransactionStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  REVERSED = 'reversed',
}

/** Ledger of every naira movement for an order. The order's escrow balance is HOLD minus releases and refunds. */
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

  /** Our unique reference sent to Paystack (transaction, transfer or refund). */
  @Index({ unique: true })
  @Column({ type: 'varchar' })
  reference: string;

  /** Paystack's transfer_code / refund id, once known. */
  @Column({ type: 'varchar', nullable: true })
  providerCode: string | null;

  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
