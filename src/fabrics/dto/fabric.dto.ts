import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
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
  ValidateNested,
} from 'class-validator';
import { FabricUnit } from '../entities/fabric.entity.js';
import { MAX_PRICE_TIERS } from '../price-tiers.js';

export class PriceTierDto {
  @IsInt() @Min(2) @Max(200) minQuantity: number;
  @IsInt() @Min(100) @Max(10_000_000) price: number;
}

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

  /** Wholesale price breaks; ordering and pricing rules are checked in FabricsService. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PRICE_TIERS, { message: `Add at most ${MAX_PRICE_TIERS} price breaks.` })
  @ValidateNested({ each: true })
  @Type(() => PriceTierDto)
  priceTiers?: PriceTierDto[];

  @IsOptional() @IsInt() @Min(0) stock?: number;
  @IsUrl({ protocols: ['https'], require_protocol: true }) imageUrl: string;
  @IsOptional() @IsBoolean() isPublished?: boolean;
}

export class UpdateFabricDto extends PartialType(CreateFabricDto) {}
