import {
  IsBoolean,
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTenantDto {
  @IsString() @MinLength(2) @MaxLength(100) name: string;

  @Matches(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, {
    message: 'slug must be 3-40 chars of lowercase letters, digits or hyphens',
  })
  slug: string;

  @IsEmail() adminEmail: string;
  @IsString() @MinLength(1) @MaxLength(100) adminName: string;
  @IsString() @MinLength(8) @MaxLength(128) adminPassword: string;
}

export class SetTenantActiveDto {
  @IsBoolean() active: boolean;
}
