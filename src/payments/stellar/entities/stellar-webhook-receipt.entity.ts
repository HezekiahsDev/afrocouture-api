import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

/** Webhook events from stellar-payment-service already handled (delivery is at least once). */
@Entity('stellar_webhook_receipts')
export class StellarWebhookReceipt {
  /** The service's event id. */
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ type: 'varchar', length: 32 })
  type: string;

  @CreateDateColumn({ type: 'timestamptz' })
  receivedAt: Date;
}
