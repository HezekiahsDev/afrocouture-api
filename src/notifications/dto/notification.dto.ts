import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsBoolean, IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListNotificationsQuery {
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(50) limit?: number;
  /** ISO timestamp: return notifications older than this (for "load more"). */
  @IsOptional() @IsISO8601() before?: string;
  @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === '1') @IsBoolean() unread?: boolean;
}

/** Mark notifications read: specific ids, everything for one order, or all. */
export class MarkReadDto {
  @IsOptional() @IsUUID('4', { each: true }) @ArrayMaxSize(100) ids?: string[];
  @IsOptional() @IsUUID() orderId?: string;
  @IsOptional() @IsBoolean() all?: boolean;
}
