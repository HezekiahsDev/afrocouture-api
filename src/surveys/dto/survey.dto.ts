import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsObject, IsOptional, Max, Min } from 'class-validator';

const toInt = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));

/** Answers keyed by question id; `null` clears one. Each answer is checked in survey.logic.ts. */
export class SaveSurveyAnswersDto {
  @IsObject() answers: Record<string, unknown>;
}

export class ListSurveyResponsesQuery {
  @IsOptional() @IsIn(['completed', 'in_progress']) status?: 'completed' | 'in_progress';
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) page?: number;
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) @Max(100) limit?: number;
}
