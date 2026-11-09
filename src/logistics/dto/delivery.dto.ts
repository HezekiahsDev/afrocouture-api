import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { LogisticsStatus } from '../entities/logistics-delivery.entity.js';

const phone = { message: 'Enter a valid phone number.' };

export class DeliveryCoordinatesDto {
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(-90) @Max(90) lat: number;
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(-180) @Max(180) lng: number;
}

export class DeliveryStopDto extends DeliveryCoordinatesDto {
  /** e.g. "Atelier" or "Home" — shown to the rider. */
  @IsOptional() @IsString() @MaxLength(80) label?: string;

  @IsString() @Length(4, 250) address: string;

  @IsString() @Length(2, 80) contactName: string;

  @Matches(/^\+?[0-9 ()-]{7,20}$/, phone)
  contactPhone: string;
}

export class QuoteDeliveryDto {
  @ValidateNested()
  @Type(() => DeliveryCoordinatesDto)
  pickup: DeliveryCoordinatesDto;

  @ValidateNested()
  @Type(() => DeliveryCoordinatesDto)
  dropoff: DeliveryCoordinatesDto;
}

export class CreateDeliveryDto {
  @ValidateNested()
  @Type(() => DeliveryStopDto)
  pickup: DeliveryStopDto;

  @ValidateNested()
  @Type(() => DeliveryStopDto)
  dropoff: DeliveryStopDto;

  @IsOptional() @IsInt() @Min(1) @Max(50) packageCount?: number;

  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class CancelDeliveryDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class SimulateDeliveryDto {
  @IsIn([
    LogisticsStatus.ASSIGNED,
    LogisticsStatus.PICKED_UP,
    LogisticsStatus.IN_TRANSIT,
    LogisticsStatus.DELIVERED,
    LogisticsStatus.COMPLETED,
    LogisticsStatus.FAILED,
  ])
  status: LogisticsStatus;
}

export class AdminListDeliveriesQuery {
  @IsOptional() @IsIn(Object.values(LogisticsStatus)) status?: LogisticsStatus;

  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) page?: number;

  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(100) limit?: number;
}
