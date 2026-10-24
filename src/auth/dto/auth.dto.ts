import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { UserRole } from '../../types/index.js';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase().trim() : value;

/** Roles a person may pick for themselves — admin is never self-assigned. */
export const SELF_SERVICE_ROLES = [UserRole.CUSTOMER, UserRole.TAILOR, UserRole.MERCHANT] as const;

export class RegisterDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Enter a valid email address.' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(72, { message: 'Password must be at most 72 characters.' })
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'Password must contain a letter and a number.' })
  password: string;

  @IsString()
  @Length(2, 80, { message: 'Enter your full name.' })
  fullName: string;

  @IsOptional()
  @IsIn(SELF_SERVICE_ROLES)
  role?: UserRole;
}

export class EmailDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Enter a valid email address.' })
  email: string;
}

export class VerifyEmailDto extends EmailDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code from your email.' })
  code: string;
}

export class LoginDto extends EmailDto {
  @IsString()
  @MinLength(1, { message: 'Enter your password.' })
  password: string;
}

export class RefreshDto {
  @IsString()
  refreshToken: string;
}

export class ResetPasswordDto extends VerifyEmailDto {
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(72, { message: 'Password must be at most 72 characters.' })
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'Password must contain a letter and a number.' })
  password: string;
}
