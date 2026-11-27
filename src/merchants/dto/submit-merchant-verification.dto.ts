import {
  IsIn,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { SourcingType } from '../entities/merchant-profile.entity.js';
import { PAYOUT_METHODS, type PayoutMethod } from '../../common/payout-account.js';

const url = { protocols: ['https'], require_protocol: true };

/** Every field is optional so the form can be saved as a draft; completeness is checked on submit. */
export class SaveMerchantProfileDto {
  @IsOptional() @IsString() @Length(2, 120) businessName?: string;
  @IsOptional() @IsString() @Length(2, 60) city?: string;
  @IsOptional() @IsString() @Length(2, 60) state?: string;
  @IsOptional() @IsString() @MaxLength(160) marketHub?: string;
  @IsOptional() @IsEnum(SourcingType) sourcingType?: SourcingType;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  specialtyFabrics?: string[];

  @IsOptional()
  @Matches(/^(RC|BN|IT|LP|LLP)[- ]?\d{4,8}$/i, { message: 'Enter a CAC number like RC-123456 or BN-1234567.' })
  cacNumber?: string;

  @IsOptional() @IsUrl(url) cacCertificateUrl?: string;
  @IsOptional() @IsUrl(url) warehousePhotoUrl?: string;
  @IsOptional() @IsBoolean() qualityDeclarationAccepted?: boolean;
  @IsOptional() @IsString() @MaxLength(80) bankName?: string;

  /** Paystack bank code from GET /payments/banks. */
  @IsOptional()
  @Matches(/^[0-9A-Za-z]{2,10}$/, { message: 'Choose your bank from the list.' })
  bankCode?: string;

  @IsOptional()
  @Matches(/^\d{10}$/, { message: 'Account number must be a 10-digit NUBAN.' })
  accountNumber?: string;

  @IsOptional() @IsString() @MaxLength(120) accountName?: string;

  /** 'bank' (default) or 'stellar' for USDC payouts. */
  @IsOptional()
  @IsIn(PAYOUT_METHODS, { message: 'Choose bank or Stellar (USDC) payouts.' })
  payoutMethod?: PayoutMethod;

  /** Stellar account that receives USDC payouts. Send an empty string to clear it. */
  @IsOptional()
  @Matches(/^(G[A-Z2-7]{55})?$/i, { message: 'Enter a valid Stellar address (starts with G, 56 characters).' })
  stellarAddress?: string;

  /** Memo the receiving exchange requires (a number or up to 28 characters). Empty string clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(28, { message: 'A Stellar memo is at most 28 characters.' })
  stellarMemo?: string;
}
