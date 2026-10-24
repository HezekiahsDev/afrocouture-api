import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/** Append-only history of an order (status changes, milestones, shipping, payouts) for the timeline. */
@Entity('order_events')
@Index(['orderId', 'createdAt'])
export class OrderEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  orderId: string;

  /** e.g. 'requested', 'quoted', 'paid', 'milestone', 'fabric_shipped', 'delivered', 'completed', 'disputed', 'payout' */
  @Column({ type: 'varchar' })
  type: string;

  /** Human-readable line shown in the timeline and posted to chat as a system message. */
  @Column({ type: 'varchar' })
  label: string;

  /** Who caused it; null for system / Paystack webhooks. */
  @Column({ type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  data: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
