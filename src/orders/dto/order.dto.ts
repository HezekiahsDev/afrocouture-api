import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { FabricDestination, OrderMilestone } from '../entities/order.entity.js';
import { DeliveryAddressDto } from '../../measurements/dto/save-measurements.dto.js';

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

export const MAX_CHECKOUT_FABRICS = 20;

/** Pay for fabric now, without a commission. */
export class FabricCheckoutDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one fabric.' })
  @ArrayMaxSize(MAX_CHECKOUT_FABRICS, { message: `Check out at most ${MAX_CHECKOUT_FABRICS} fabrics at a time.` })
  @ValidateNested({ each: true })
  @Type(() => OrderFabricDto)
  fabrics: OrderFabricDto[];

  @IsEnum(FabricDestination) destination: FabricDestination;

  @ValidateIf((dto: FabricCheckoutDto) => dto.destination === FabricDestination.TAILOR)
  @IsUUID()
  tailorId?: string;

  @ValidateIf((dto: FabricCheckoutDto) => dto.destination === FabricDestination.CUSTOMER)
  @IsDefined({ message: 'Add the address to deliver to.' })
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress?: DeliveryAddressDto;
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

/** Rating a completed order after the fact (e.g. it was completed automatically). */
export class ReviewDto {
  @IsInt() @Min(1) @Max(5) rating: number;
  @IsOptional() @IsString() @MaxLength(1000) review?: string;
}

export class ReviewReplyDto {
  @IsString() @MinLength(2) @MaxLength(1000) reply: string;
}

export class HideReviewDto {
  @IsBoolean() hidden: boolean;
}

export class ListReviewsQuery {
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(50) limit?: number;
  /** ISO timestamp of the last review already shown. */
  @IsOptional() @IsISO8601() before?: string;
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
