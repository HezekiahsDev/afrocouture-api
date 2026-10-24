import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/** Editorial silhouettes shown in "Wear the occasion". */
@Entity('styles')
export class Style {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  /** Occasion label, e.g. "Celebrations". */
  @Column({ type: 'varchar' })
  category: string;

  @Column({ type: 'varchar' })
  imageUrl: string;

  /** Typical lowest price in naira for this silhouette. */
  @Column({ type: 'int', nullable: true })
  startingPrice: number | null;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'boolean', default: true })
  isPublished: boolean;

  @Column({ type: 'boolean', default: false })
  isSample: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
