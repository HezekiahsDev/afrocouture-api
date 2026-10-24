import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
  type Relation,
} from 'typeorm';
import type { DeliveryAddress } from '../../measurements/entities/customer-fit-profile.entity.js';
import type { OrderItem } from './order-item.entity.js';

/**
 * Lifecycle of a commission:
 *
 *   requested ──tailor quotes──▶ quoted ──customer pays (Paystack)──▶ paid
 *       │                          │                                   │ tailor starts work
 *       └─tailor declines▶ declined └─customer cancels▶ cancelled       ▼
 *                                                                in_progress ──tailor hands over──▶ delivered
 *                                                                                                     │
 *                              customer approves (funds released) ◀──────────────────────────────────┤
 *                                       completed                    customer disputes ▶ disputed ──admin▶ completed | refunded
 */
export enum OrderStatus {
  REQUESTED = 'requested',
  QUOTED = 'quoted',
  DECLINED = 'declined',
  CANCELLED = 'cancelled',
  PAID = 'paid',
  IN_PROGRESS = 'in_progress',
  DELIVERED = 'delivered',
  COMPLETED = 'completed',
  DISPUTED = 'disputed',
  REFUNDED = 'refunded',
}

/** Production stage shown on the 4-step tracker while the order is paid / in progress / delivered. */
export enum OrderMilestone {
  PLACED = 'placed',
  CUTTING = 'cutting',
  FITTING = 'fitting',
  DELIVERY = 'delivery',
}

/** Copy of the customer's fit profile at the moment they requested — later edits don't change a live order. */
export interface FitSnapshot {
  chest: number | null;
  shoulderWidth: number | null;
  sleeveLength: number | null;
  kaftanLength: number | null;
  waist: number | null;
  neck: number | null;
  drapeSilhouette: string;
  unit: string;
  frontPhotoUrl: string | null;
  sidePhotoUrl: string | null;
}

@Entity('orders')
@Index(['customerId', 'createdAt'])
@Index(['tailorUserId', 'createdAt'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Short human reference, e.g. "AC-7F3K2Q" — also the Paystack transaction reference prefix. */
  @Index({ unique: true })
  @Column({ type: 'varchar' })
  reference: string;

  @Column({ type: 'uuid' })
  customerId: string;

  /** TailorProfile.id */
  @Column({ type: 'uuid' })
  tailorId: string;

  /** The tailor's User.id, denormalised for access checks. */
  @Column({ type: 'uuid' })
  tailorUserId: string;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.REQUESTED })
  status: OrderStatus;

  @Column({ type: 'enum', enum: OrderMilestone, default: OrderMilestone.PLACED })
  milestone: OrderMilestone;

  // ── The request ──
  /** e.g. "Agbada", "Aso Ebi gown" */
  @Column({ type: 'varchar' })
  garmentType: string;

  @Column({ type: 'text' })
  brief: string;

  @Column({ type: 'uuid', nullable: true })
  styleId: string | null;

  @Column({ type: 'uuid', nullable: true })
  aiDesignId: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  referenceImageUrls: string[];

  @Column({ type: 'jsonb' })
  fitSnapshot: FitSnapshot;

  @Column({ type: 'jsonb' })
  deliveryAddress: DeliveryAddress;

  @Column({ type: 'date', nullable: true })
  desiredDate: string | null;

  // ── The tailor's quote (naira) ──
  @Column({ type: 'int', nullable: true })
  workmanshipPrice: number | null;

  @Column({ type: 'int', nullable: true })
  deliveryFee: number | null;

  @Column({ type: 'date', nullable: true })
  estimatedDeliveryDate: string | null;

  @Column({ type: 'text', nullable: true })
  quoteNote: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  quotedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  declineReason: string | null;

  // ── Money (naira, whole numbers) ──
  /** Sum of fabric line totals (tier prices applied at request time). */
  @Column({ type: 'int', default: 0 })
  fabricTotal: number;

  /** PLATFORM_FEE_PERCENT of (workmanship + delivery + fabric), charged to the customer on top. */
  @Column({ type: 'int', default: 0 })
  platformFee: number;

  /** What the customer pays: workmanship + delivery + fabric + platform fee. Set when quoted. */
  @Column({ type: 'int', default: 0 })
  totalAmount: number;

  // ── Payment ──
  /** Reference of the Paystack transaction that funded this order (unique per attempt). */
  @Index({ unique: true, where: '"paystackReference" IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  paystackReference: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  // ── Disputes ──
  @Column({ type: 'text', nullable: true })
  disputeReason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  disputedAt: Date | null;

  /** Admin's note when resolving a dispute (shown to both parties). */
  @Column({ type: 'text', nullable: true })
  resolutionNote: string | null;

  /** Customer's rating (1–5), left when approving delivery or afterwards from the order page. */
  @Column({ type: 'int', nullable: true })
  rating: number | null;

  @Column({ type: 'text', nullable: true })
  review: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  /** The artisan's public reply to the review (one reply, set once). */
  @Column({ type: 'text', nullable: true })
  reviewReply: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewRepliedAt: Date | null;

  /** Set by an admin to take a review off the artisan's profile and out of their average. */
  @Column({ type: 'timestamptz', nullable: true })
  reviewHiddenAt: Date | null;

  @OneToMany('OrderItem', (item: OrderItem) => item.order, { cascade: ['insert'] })
  items: Relation<OrderItem>[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
