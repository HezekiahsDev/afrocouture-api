import { PartialType } from '@nestjs/mapped-types';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { FabricUnit } from '../entities/fabric.entity.js';

export class CreateFabricDto {
  @IsString() @Length(2, 120) name: string;
  @IsString() @Length(2, 40) category: string;
  @IsOptional() @IsString() @MaxLength(80) origin?: string;
  @IsOptional() @IsString() @MaxLength(1200) description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];

  @IsInt() @Min(100) @Max(10_000_000) price: number;
  @IsOptional() @IsEnum(FabricUnit) unit?: FabricUnit;
  @IsOptional() @IsInt() @Min(0) stock?: number;
  @IsUrl({ protocols: ['https'], require_protocol: true }) imageUrl: string;
  @IsOptional() @IsBoolean() isPublished?: boolean;
}

export class UpdateFabricDto extends PartialType(CreateFabricDto) {}
