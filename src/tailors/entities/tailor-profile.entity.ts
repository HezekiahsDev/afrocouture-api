import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { KycStatus } from '../../types/index.js';

@Entity('tailor_profiles')
export class TailorProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Null only for seeded sample artisans that have no account. */
  @Index({ unique: true, where: '"userId" IS NOT NULL' })
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  // ── Public atelier profile ──
  @Column({ type: 'varchar', nullable: true })
  displayName: string | null;

  @Column({ type: 'varchar', nullable: true })
  atelierName: string | null;

  @Column({ type: 'varchar', nullable: true })
  city: string | null;

  /** One-line description of the craft, e.g. "Heritage embroidery & agbada". */
  @Column({ type: 'varchar', nullable: true })
  craft: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ type: 'int', nullable: true })
  yearsExperience: number | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  specialtyTags: string[];

  /** Lowest commission price in naira. */
  @Column({ type: 'int', nullable: true })
  startingPrice: number | null;

  @Column({ type: 'varchar', nullable: true })
  portraitUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  coverImageUrl: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  portfolioUrls: string[];

  @Column({ type: 'numeric', precision: 2, scale: 1, nullable: true })
  rating: string | null;

  @Column({ type: 'int', default: 0 })
  reviewCount: number;

  // ── Private KYC (owner + admin only) ──
  @Column({ type: 'varchar', nullable: true })
  legalName: string | null;

  @Column({ type: 'text', nullable: true })
  workshopAddress: string | null;

  @Column({ type: 'varchar', nullable: true })
  idType: string | null;

  @Column({ type: 'varchar', nullable: true })
  idDocumentUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  workshopPhotoUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  guildChapter: string | null;

  @Column({ type: 'varchar', nullable: true })
  guildMembershipId: string | null;

  @Column({ type: 'varchar', nullable: true })
  bankName: string | null;

  @Column({ type: 'varchar', nullable: true })
  accountNumber: string | null;

  @Column({ type: 'varchar', nullable: true })
  accountName: string | null;

  // ── Review ──
  @Column({ type: 'enum', enum: KycStatus, default: KycStatus.DRAFT })
  kycStatus: KycStatus;

  @Column({ type: 'text', nullable: true })
  reviewNote: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  /** Illustrative catalogue entry from the seed script, not a real artisan. */
  @Column({ type: 'boolean', default: false })
  isSample: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
