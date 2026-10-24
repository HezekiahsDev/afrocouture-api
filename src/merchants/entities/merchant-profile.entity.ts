import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { KycStatus } from '../../types/index.js';

export enum SourcingType {
  /** Buys directly from mills or weavers. */
  DIRECT_MILL = 'direct_mill',
  /** Imports finished textiles for resale. */
  IMPORTER = 'importer',
}

@Entity('merchant_profiles')
export class MerchantProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Null only for seeded sample merchants that have no account. */
  @Index({ unique: true, where: '"userId" IS NOT NULL' })
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  // ── Public storefront ──
  @Column({ type: 'varchar', nullable: true })
  businessName: string | null;

  @Column({ type: 'varchar', nullable: true })
  city: string | null;

  /** Market or warehouse the stock ships from, e.g. "Kantin Kwari Market, Kano". */
  @Column({ type: 'varchar', nullable: true })
  marketHub: string | null;

  @Column({ type: 'enum', enum: SourcingType, nullable: true })
  sourcingType: SourcingType | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  specialtyFabrics: string[];

  // ── Private verification (owner + admin only) ──
  @Column({ type: 'varchar', nullable: true })
  cacNumber: string | null;

  @Column({ type: 'varchar', nullable: true })
  cacCertificateUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  warehousePhotoUrl: string | null;

  /** The merchant confirmed their fabric descriptions (fibre, colourfastness) are accurate. */
  @Column({ type: 'boolean', default: false })
  qualityDeclarationAccepted: boolean;

  @Column({ type: 'varchar', nullable: true })
  bankName: string | null;

  @Column({ type: 'varchar', nullable: true })
  accountNumber: string | null;

  @Column({ type: 'varchar', nullable: true })
  accountName: string | null;

  // ── Review ──
  @Column({ type: 'enum', enum: KycStatus, default: KycStatus.DRAFT })
  verificationStatus: KycStatus;

  @Column({ type: 'text', nullable: true })
  reviewNote: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ type: 'boolean', default: false })
  isSample: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
