import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { MerchantProfile } from '../../merchants/entities/merchant-profile.entity.js';

/** A wholesale price break: buying at least `minQuantity` units costs `price` per unit. */
export interface PriceTier {
  minQuantity: number;
  price: number;
}

export enum FabricUnit {
  YARD = 'yard',
  BUNDLE = 'bundle',
}

@Entity('fabrics')
@Index(['isPublished', 'category'])
export class Fabric {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  merchantId: string;

  @ManyToOne(() => MerchantProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'merchantId' })
  merchant: MerchantProfile;

  @Column({ type: 'varchar' })
  name: string;

  /** Fabric family shown in filters, e.g. "Ankara", "Voile", "Aso Oke". */
  @Column({ type: 'varchar' })
  category: string;

  @Column({ type: 'varchar', nullable: true })
  origin: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  tags: string[];

  /** Price in naira per unit. */
  @Column({ type: 'int' })
  price: number;

  @Column({ type: 'enum', enum: FabricUnit, default: FabricUnit.YARD })
  unit: FabricUnit;

  /** Optional price breaks, ascending by minQuantity, each cheaper than `price`. Empty = flat price. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  priceTiers: PriceTier[];

  @Column({ type: 'int', nullable: true })
  stock: number | null;

  @Column({ type: 'varchar' })
  imageUrl: string;

  @Column({ type: 'boolean', default: true })
  isPublished: boolean;

  @Column({ type: 'boolean', default: false })
  isSample: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
