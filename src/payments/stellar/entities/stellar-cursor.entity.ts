import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/** Where the payment watcher got to in Horizon's payment stream. Kept in Postgres: losing it means re-reading history. */
@Entity('stellar_cursors')
export class StellarCursor {
  @PrimaryColumn({ type: 'varchar', length: 40 })
  key: string;

  @Column({ type: 'varchar', length: 40 })
  pagingToken: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
