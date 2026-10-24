import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  type Relation,
} from 'typeorm';
import type { Order } from './order.entity.js';

/** Where a fabric line is in getting from the merchant to the tailor's workshop. */
export enum FabricFulfilment {
  PENDING = 'pending',
  SHIPPED = 'shipped',
  RECEIVED = 'received',
}

/** A fabric bought as part of a commission. Prices are snapshots taken when the order was requested. */
@Entity('order_items')
@Index(['merchantId'])
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne('Order', (order: Order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Relation<Order>;

  @Column({ type: 'uuid' })
  fabricId: string;

  /** MerchantProfile.id */
  @Column({ type: 'uuid' })
  merchantId: string;

  @Column({ type: 'varchar' })
  fabricName: string;

  @Column({ type: 'varchar' })
  imageUrl: string;

  /** 'yard' | 'bundle' */
  @Column({ type: 'varchar' })
  unit: string;

  @Column({ type: 'int' })
  quantity: number;

  /** Naira per unit after any wholesale tier was applied. */
  @Column({ type: 'int' })
  unitPrice: number;

  @Column({ type: 'int' })
  lineTotal: number;

  @Column({ type: 'enum', enum: FabricFulfilment, default: FabricFulfilment.PENDING })
  fulfilment: FabricFulfilment;

  /** Courier / tracking details the merchant adds when shipping. */
  @Column({ type: 'text', nullable: true })
  shippingNote: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  shippedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  receivedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
