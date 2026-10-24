import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { OrderMilestone } from '../entities/order.entity.js';

const https = { protocols: ['https'], require_protocol: true };

export class OrderFabricDto {
  @IsUUID() fabricId: string;
  @IsInt() @Min(1) @Max(200) quantity: number;
}

export class CreateOrderDto {
  @IsUUID() tailorId: string;
  @IsString() @Length(2, 60) garmentType: string;

  @IsString()
  @Length(20, 2000, { message: 'Describe what you want in at least 20 characters.' })
  brief: string;

  @IsOptional() @IsUUID() styleId?: string;
  @IsOptional() @IsUUID() aiDesignId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsUrl(https, { each: true })
  referenceImageUrls?: string[];

  @IsOptional() @IsDateString({ strict: true }) desiredDate?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5, { message: 'Add at most 5 fabrics to one order.' })
  @ValidateNested({ each: true })
  @Type(() => OrderFabricDto)
  fabrics?: OrderFabricDto[];

  /** Add the fabrics from the customer's saved selection (with their saved quantities). */
  @IsOptional() @IsBoolean() useSavedFabrics?: boolean;
}

export class QuoteDto {
  @IsInt() @Min(1000) @Max(50_000_000) workmanshipPrice: number;
  @IsInt() @Min(0) @Max(1_000_000) deliveryFee: number;
  @IsDateString({ strict: true }) estimatedDeliveryDate: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ReasonDto {
  @IsString() @Length(5, 1000, { message: 'Give a short reason (at least 5 characters).' }) reason: string;
}

export class VerifyPaymentDto {
  @IsString() @Length(4, 100) reference: string;
}

export class MilestoneDto {
  @IsIn([OrderMilestone.CUTTING, OrderMilestone.FITTING, OrderMilestone.DELIVERY])
  milestone: OrderMilestone;

  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class NoteDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ApproveDto {
  @IsInt() @Min(1) @Max(5) rating: number;
  @IsOptional() @IsString() @MaxLength(1000) review?: string;
}

export class ResolveDisputeDto {
  @IsIn(['release', 'refund']) outcome: 'release' | 'refund';

  /** Naira to refund; omitted = the whole remaining balance. */
  @ValidateIf((dto: ResolveDisputeDto) => dto.outcome === 'refund' && dto.refundAmount !== undefined)
  @IsInt()
  @Min(1)
  refundAmount?: number;

  @IsString() @Length(5, 1000, { message: 'Explain the decision to both parties.' }) note: string;
}

export class ListOrdersQuery {
  @IsOptional() @IsIn(['customer', 'tailor', 'merchant']) role?: 'customer' | 'tailor' | 'merchant';
  @IsOptional() @IsString() status?: string;
}
