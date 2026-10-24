import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/** Append-only record of what admins did, for accountability. */
@Entity('admin_audit_log')
@Index(['createdAt'])
@Index(['targetType', 'targetId'])
export class AdminAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  adminId: string;

  /** e.g. 'verification.approve', 'user.suspend', 'fabric.unpublish' */
  @Column({ type: 'varchar' })
  action: string;

  /** 'tailor' | 'merchant' | 'order' | 'escrow_transaction' | 'user' | 'review' | 'fabric' */
  @Column({ type: 'varchar' })
  targetType: string;

  @Column({ type: 'varchar' })
  targetId: string;

  @Column({ type: 'varchar' })
  summary: string;

  @Column({ type: 'jsonb', nullable: true })
  details: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
