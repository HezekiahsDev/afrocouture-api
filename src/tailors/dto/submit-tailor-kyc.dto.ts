import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const url = { protocols: ['https'], require_protocol: true };

/** Every field is optional so the form can be saved as a draft; completeness is checked on submit. */
export class SaveTailorProfileDto {
  @IsOptional() @IsString() @Length(2, 80) displayName?: string;
  @IsOptional() @IsString() @Length(2, 120) atelierName?: string;
  @IsOptional() @IsString() @Length(2, 60) city?: string;
  @IsOptional() @IsString() @MaxLength(120) craft?: string;
  @IsOptional() @IsString() @MaxLength(1200) bio?: string;
  @IsOptional() @IsInt() @Min(0) @Max(70) yearsExperience?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  specialtyTags?: string[];

  @IsOptional() @IsInt() @Min(1000) @Max(50_000_000) startingPrice?: number;
  @IsOptional() @IsUrl(url) portraitUrl?: string;
  @IsOptional() @IsUrl(url) coverImageUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsUrl(url, { each: true })
  portfolioUrls?: string[];

  @IsOptional() @IsString() @Length(2, 120) legalName?: string;
  @IsOptional() @IsString() @MaxLength(300) workshopAddress?: string;
  @IsOptional() @IsString() @MaxLength(60) idType?: string;
  @IsOptional() @IsUrl(url) idDocumentUrl?: string;
  @IsOptional() @IsUrl(url) workshopPhotoUrl?: string;
  @IsOptional() @IsString() @MaxLength(120) guildChapter?: string;
  @IsOptional() @IsString() @MaxLength(60) guildMembershipId?: string;
  @IsOptional() @IsString() @MaxLength(80) bankName?: string;

  /** Paystack bank code from GET /payments/banks. */
  @IsOptional()
  @Matches(/^[0-9A-Za-z]{2,10}$/, { message: 'Choose your bank from the list.' })
  bankCode?: string;

  @IsOptional()
  @Matches(/^\d{10}$/, { message: 'Account number must be a 10-digit NUBAN.' })
  accountNumber?: string;

  @IsOptional() @IsString() @MaxLength(120) accountName?: string;
}
