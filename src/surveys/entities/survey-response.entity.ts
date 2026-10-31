import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import type { SurveyAnswers } from '../definitions/index.js';

/** One person's answers to one survey version. Saved as they go; `completedAt` marks a submitted form. */
@Entity('survey_responses')
@Unique(['userId', 'surveyId'])
@Index(['surveyId', 'completedAt'])
export class SurveyResponse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  /** Survey definition id, e.g. `customer-v1` (src/surveys/definitions). */
  @Column({ type: 'varchar', length: 40 })
  surveyId: string;

  /** The role the person had when they answered. */
  @Column({ type: 'varchar', length: 20 })
  role: string;

  @Column({ type: 'jsonb', default: {} })
  answers: SurveyAnswers;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  /** Set when the person closes the survey prompt; the page stays available. */
  @Column({ type: 'timestamptz', nullable: true })
  promptDismissedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
