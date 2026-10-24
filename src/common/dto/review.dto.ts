import { IsIn, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

export class ReviewDecisionDto {
  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';

  /** Required when rejecting — it is emailed to the applicant so they can fix it. */
  @ValidateIf((dto: ReviewDecisionDto) => dto.decision === 'reject' || dto.note !== undefined)
  @IsString()
  @IsNotEmpty({ message: 'Give a reason so the applicant knows what to fix.' })
  @MaxLength(1000)
  note?: string;
}
