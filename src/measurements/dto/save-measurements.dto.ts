import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MeasurementUnit } from '../../types/index.js';

const url = { protocols: ['https'], require_protocol: true };

export class DeliveryAddressDto {
  @IsString() @Length(4, 200) line1: string;
  @IsString() @Length(2, 60) city: string;
  @IsString() @Length(2, 60) state: string;
  @IsOptional() @IsString() @MaxLength(120) landmark?: string;

  @IsOptional()
  @Matches(/^\+?[0-9 ]{7,16}$/, { message: 'Enter a valid phone number.' })
  phone?: string;
}

export class SaveMeasurementsDto {
  // Bounds are wide enough for inches and centimetres; `unit` says which.
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(5) @Max(200) chest?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(5) @Max(200) shoulderWidth?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(5) @Max(200) sleeveLength?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(5) @Max(200) kaftanLength?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(5) @Max(200) waist?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(5) @Max(200) neck?: number | null;

  @IsOptional()
  @IsIn(['slim_modern', 'classic_regal', 'relaxed_casual'])
  drapeSilhouette?: string;

  @IsOptional() @IsEnum(MeasurementUnit) unit?: MeasurementUnit;
  @IsOptional() @IsUrl(url) frontPhotoUrl?: string | null;
  @IsOptional() @IsUrl(url) sidePhotoUrl?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress?: DeliveryAddressDto;
}
