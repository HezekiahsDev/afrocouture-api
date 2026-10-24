import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { UserRole } from '../../types/index.js';

const toInt = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));
const toBool = ({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value);

class PageQuery {
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) page?: number;
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class ListUsersQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @IsIn(Object.values(UserRole)) role?: UserRole;
  @IsOptional() @IsIn(['active', 'suspended']) status?: 'active' | 'suspended';
}

export class SuspendUserDto {
  @IsString() @MinLength(5) @MaxLength(500) reason: string;
}

export class ListAdminOrdersQuery extends PageQuery {
  /** One status, a comma-separated list, or omitted for all. Validated in the service. */
  @IsOptional() @IsString() @MaxLength(200) status?: string;
  @IsOptional() @IsString() @MaxLength(200) q?: string;
}

export class ListAdminFabricsQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @Transform(toBool) @IsBoolean() published?: boolean;
}

export class ModerateFabricDto {
  @IsBoolean() isPublished: boolean;

  /** Required when unpublishing; shown to the merchant. */
  @ValidateIf((dto: ModerateFabricDto) => dto.isPublished === false || dto.note !== undefined)
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  note?: string;
}

export class ListAuditQuery {
  @IsOptional() @IsString() @MaxLength(100) action?: string;
  @IsOptional() @IsString() @MaxLength(100) targetType?: string;
  @IsOptional() @IsString() @MaxLength(100) targetId?: string;
  @IsOptional() @IsUUID() adminId?: string;
  @IsOptional() @IsISO8601() before?: string;
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class AdminMessagesQuery {
  @IsOptional() @IsISO8601() before?: string;
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) @Max(100) limit?: number;
}
