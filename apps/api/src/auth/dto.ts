import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  /** 平台管理员登录时不传 */
  @IsOptional() @IsString() tenantSlug?: string;
  @IsEmail() email: string;
  @IsString() @MinLength(1) @MaxLength(128) password: string;
}

export class RefreshDto {
  @IsString() @MinLength(10) refreshToken: string;
}

export class SignupDto {
  @IsString() @MinLength(2) @MaxLength(100) tenantName: string;

  @Matches(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, {
    message: 'slug must be 3-40 chars of lowercase letters, digits or hyphens',
  })
  tenantSlug: string;

  @IsEmail() adminEmail: string;
  @IsString() @MinLength(1) @MaxLength(100) adminName: string;
  @IsString() @MinLength(8) @MaxLength(128) password: string;
}
