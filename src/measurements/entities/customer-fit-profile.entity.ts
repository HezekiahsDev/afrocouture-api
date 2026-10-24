import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, CreateDateColumn } from 'typeorm';
import { MeasurementUnit } from '../../types/index.js';

export interface DeliveryAddress {
  line1: string;
  city: string;
  state: string;
  landmark?: string;
  phone?: string;
}

/** Postgres returns numeric columns as strings; expose them as numbers. */
const numeric = { to: (v?: number | null) => v, from: (v: string | null) => (v === null ? null : Number(v)) };

@Entity('customer_fit_profiles')
export class CustomerFitProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  userId: string;

  @Column({ type: 'numeric', precision: 5, scale: 1, nullable: true, transformer: numeric })
  chest: number | null;

  @Column({ type: 'numeric', precision: 5, scale: 1, nullable: true, transformer: numeric })
  shoulderWidth: number | null;

  @Column({ type: 'numeric', precision: 5, scale: 1, nullable: true, transformer: numeric })
  sleeveLength: number | null;

  @Column({ type: 'numeric', precision: 5, scale: 1, nullable: true, transformer: numeric })
  kaftanLength: number | null;

  @Column({ type: 'numeric', precision: 5, scale: 1, nullable: true, transformer: numeric })
  waist: number | null;

  @Column({ type: 'numeric', precision: 5, scale: 1, nullable: true, transformer: numeric })
  neck: number | null;

  @Column({ type: 'varchar', default: 'slim_modern' })
  drapeSilhouette: string;

  @Column({ type: 'enum', enum: MeasurementUnit, default: MeasurementUnit.INCHES })
  unit: MeasurementUnit;

  /** Reference photos the tailor can check measurements against. */
  @Column({ type: 'varchar', nullable: true })
  frontPhotoUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  sidePhotoUrl: string | null;

  @Column({ type: 'jsonb', nullable: true })
  deliveryAddress: DeliveryAddress | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
