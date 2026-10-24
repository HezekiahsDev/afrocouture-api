import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export const ASPECT_RATIOS = ['3:4', '1:1', '9:16'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export class GenerateDesignDto {
  @IsString()
  @Length(10, 400, { message: 'Describe your design in 10 to 400 characters.' })
  prompt: string;

  @IsOptional() @IsString() @MaxLength(60) garmentType?: string;
  @IsOptional() @IsString() @MaxLength(60) occasion?: string;
  @IsOptional() @IsString() @MaxLength(60) fabric?: string;
  @IsOptional() @IsString() @MaxLength(60) colour?: string;

  @IsOptional() @IsInt() @Min(1) @Max(4) count?: number;
  @IsOptional() @IsIn(ASPECT_RATIOS) aspectRatio?: AspectRatio;
}

export class UpdateDesignDto {
  @IsOptional() @IsBoolean() saved?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(3) selectedIndex?: number;
}

export class ListDesignsQuery {
  @IsOptional() @IsIn(['true', 'false']) saved?: 'true' | 'false';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;

  /** ISO timestamp — return designs created before this (for paging back through history). */
  @IsOptional() @IsString() before?: string;
}
