import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/** One generation run in the AI Design Studio: a prompt and the images Imagen returned (stored on Cloudinary). */
@Entity('ai_designs')
@Index(['userId', 'createdAt'])
export class AiDesign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'text' })
  prompt: string;

  /** Optional garment type / occasion chips the user picked; folded into the model prompt. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  options: { garmentType?: string; occasion?: string; fabric?: string; colour?: string };

  /** Cloudinary URLs of the generated variations (1–4). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  imageUrls: string[];

  /** Which variation the user picked as the main design. */
  @Column({ type: 'int', default: 0 })
  selectedIndex: number;

  @Column({ type: 'varchar' })
  model: string;

  @Column({ type: 'varchar', default: '3:4' })
  aspectRatio: string;

  /** Saved to the user's collection (unsaved runs are kept as history). */
  @Column({ type: 'boolean', default: false })
  saved: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
