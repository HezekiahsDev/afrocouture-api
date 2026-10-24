import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/** One line in a person's in-app notification centre. */
@Entity('notifications')
@Index(['userId', 'createdAt'])
@Index('IDX_notifications_unread', ['userId'], { where: '"readAt" IS NULL' })
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  /** e.g. 'order_requested', 'order_quoted', 'order_milestone', 'chat', 'verification', 'review', 'admin_dispute' */
  @Column({ type: 'varchar' })
  type: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  /** In-app path to open, e.g. "/orders/<id>". */
  @Column({ type: 'varchar', nullable: true })
  link: string | null;

  /** Set for order notifications so they can be marked read when the order is opened. */
  @Column({ type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  /** Bumped when a chat notification is collapsed into an existing unread one. */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
