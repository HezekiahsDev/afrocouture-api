import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum ChatMessageType {
  TEXT = 'text',
  IMAGE = 'image',
  /** Posted by the platform for order events (quote sent, payment received, milestone reached…). */
  SYSTEM = 'system',
}

/** Messages between the customer and tailor on an order. */
@Entity('chat_messages')
@Index(['orderId', 'createdAt'])
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  orderId: string;

  /** Null for system messages. */
  @Column({ type: 'uuid', nullable: true })
  senderId: string | null;

  @Column({ type: 'enum', enum: ChatMessageType, default: ChatMessageType.TEXT })
  type: ChatMessageType;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', nullable: true })
  attachmentUrl: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
