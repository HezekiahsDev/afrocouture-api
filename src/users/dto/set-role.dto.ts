import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { UserRole } from '../../types/index.js';
import { SELF_SERVICE_ROLES } from '../../auth/dto/auth.dto.js';

export class SetRoleDto {
  @IsIn(SELF_SERVICE_ROLES, { message: 'Choose customer, tailor or merchant.' })
  role: UserRole;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  fullName?: string;

  @IsOptional()
  @Matches(/^\+?[0-9 ]{7,16}$/, { message: 'Enter a valid phone number.' })
  phone?: string;
}
