import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Delivery statuses Dali reports. Kept in sync with the partner API. */
export enum LogisticsStatus {
  PENDING = 'pending',
  ASSIGNED = 'assigned',
  PICKED_UP = 'picked_up',
  IN_TRANSIT = 'in_transit',
  DELIVERED = 'delivered',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
  DISPUTED = 'disputed',
}

/** A stop exactly as Dali stores and echoes it back. */
export interface LogisticsStop {
  lat: number;
  lng: number;
  label?: string;
  address: string;
  contact_name: string;
  contact_phone: string;
}

export interface LogisticsRunner {
  name: string;
  phone: string;
  vehicle: string;
  rating: number | null;
}

/**
 * One rider job booked with Dali for an IPILE order. Orders can be rebooked after a
 * cancellation/failure, so this is a ledger of attempts rather than a 1:1 row.
 */
@Entity('logistics_deliveries')
@Index('IDX_logistics_deliveries_order_created', ['orderId', 'createdAt'])
export class LogisticsDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  orderId: string;

  /** Our order reference (with a -D2, -D3… suffix for rebookings); unique at Dali. */
  @Index('IDX_logistics_deliveries_external_reference', { unique: true })
  @Column({ type: 'varchar' })
  externalReference: string;

  /** Dali's job id. Null only if their response was interrupted before we stored it. */
  @Index('IDX_logistics_deliveries_dali_id', { unique: true, where: '"daliId" IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  daliId: string | null;

  @Column({ type: 'enum', enum: LogisticsStatus, default: LogisticsStatus.PENDING })
  status: LogisticsStatus;

  @Column({ type: 'boolean', default: true })
  livemode: boolean;

  /** Naira, charged to the Dali prepaid balance. */
  @Column({ type: 'int', default: 0 })
  fee: number;

  @Column({ type: 'varchar', default: 'NGN' })
  currency: string;

  @Column({ type: 'int', nullable: true })
  distanceM: number | null;

  /** Customer-facing handover PIN. Never shown to the artisan or merchant. */
  @Column({ type: 'varchar', nullable: true })
  deliveryPin: string | null;

  @Column({ type: 'jsonb', nullable: true })
  runner: LogisticsRunner | null;

  @Column({ type: 'jsonb' })
  pickup: LogisticsStop;

  @Column({ type: 'jsonb' })
  dropoff: LogisticsStop;

  @Column({ type: 'int', default: 1 })
  packageCount: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'text', nullable: true })
  cancelReason: string | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  assignedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  pickedUpAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  failedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/**
 * Webhook deliveries, kept so a repeated event id is acknowledged but only processed once.
 * The raw payload is useful when Dali support asks what we received.
 */
@Entity('logistics_webhook_events')
@Index('IDX_logistics_webhook_events_delivery_created', ['deliveryId', 'createdAt'])
export class LogisticsWebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_logistics_webhook_events_event_id', { unique: true })
  @Column({ type: 'varchar' })
  eventId: string;

  @Column({ type: 'varchar' })
  type: string;

  @Column({ type: 'uuid', nullable: true })
  deliveryId: string | null;

  @Column({ type: 'varchar', nullable: true })
  jobId: string | null;

  @Column({ type: 'boolean', default: true })
  livemode: boolean;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
