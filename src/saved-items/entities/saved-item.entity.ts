import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';

export enum SavedItemType {
  TAILOR = 'tailor',
  FABRIC = 'fabric',
}

/** A customer's shortlist: saved artisans and fabrics (with the yardage they plan to buy). */
@Entity('saved_items')
@Unique(['userId', 'itemType', 'itemId'])
export class SavedItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'enum', enum: SavedItemType })
  itemType: SavedItemType;

  @Column({ type: 'uuid' })
  itemId: string;

  /** Planned yards/bundles for fabrics; null for artisans. */
  @Column({ type: 'int', nullable: true })
  quantity: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
