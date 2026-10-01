import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  MinLength,
} from 'class-validator';
import { Role } from '../generated/prisma/enums.js';

export class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsString() @MinLength(8) @MaxLength(128) password: string;
  @IsEnum(Role) role: Role;
  @IsOptional() @IsUUID() functionalRoleId?: string;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(128) password?: string;
  /** null 表示清除 */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() functionalRoleId?: string | null;
}

export class CreateFunctionalRoleDto {
  @IsString() @MinLength(1) @MaxLength(30) name: string;
}

export class UpdateFunctionalRoleDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(30) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
