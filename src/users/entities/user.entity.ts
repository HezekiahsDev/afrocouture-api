import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { UserRole } from '../../types/index.js';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  email: string;

  @Column({ type: 'varchar', nullable: true })
  fullName?: string | null;

  @Column({ type: 'varchar', nullable: true })
  phone?: string | null;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.CUSTOMER,
  })
  role: UserRole;

  @Column({ type: 'varchar', default: 'active' })
  status: string;

  @Column({ type: 'boolean', default: false })
  emailVerified: boolean;

  @Column({ type: 'varchar', nullable: true, select: false })
  passwordHash?: string | null;

  /** sha256 of the current refresh token; rotated on every refresh, cleared on logout. */
  @Column({ type: 'varchar', nullable: true, select: false })
  refreshTokenHash?: string | null;

  /** When an admin suspended the account (cleared on reactivation). Admin-only, so not selected by default. */
  @Column({ type: 'timestamptz', nullable: true, select: false })
  suspendedAt?: Date | null;

  @Column({ type: 'text', nullable: true, select: false })
  suspensionReason?: string | null;

  /**
   * When they chose how they'll use AfroCouture (shop, make or sell). Null until then, so a
   * returning account that never chose is sent back to that step after signing in.
   */
  @Column({ type: 'timestamptz', nullable: true })
  pathChosenAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
