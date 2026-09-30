import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { BaselineType, ConfigKind } from '../generated/prisma/enums.js';

const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/;

export class CreateConfigItemDto {
  @Matches(CODE) code: string;
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsEnum(ConfigKind) kind: ConfigKind;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsBoolean() safetyRelated?: boolean;
  @IsOptional() @IsBoolean() lowestLevel?: boolean;
  @IsOptional() @IsString() @MaxLength(20) revision?: string;
  @IsOptional() @IsString() @MaxLength(100) serialNumber?: string;
  @IsOptional() @IsString() @MaxLength(100) batchNumber?: string;
}

export class UpdateConfigItemDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsBoolean() safetyRelated?: boolean;
  @IsOptional() @IsBoolean() lowestLevel?: boolean;
  @IsOptional() @IsString() @MaxLength(20) revision?: string;
  @IsOptional() @IsString() @MaxLength(100) serialNumber?: string;
  @IsOptional() @IsString() @MaxLength(100) batchNumber?: string;
  @IsOptional() @IsBoolean() obsolete?: boolean;
  /** 建立基线后修改受控字段必须引用已批准或已实施的变更申请 */
  @IsOptional() @IsUUID() changeRequestId?: string;
}

export class CreateBaselineDto {
  @IsEnum(BaselineType) type: BaselineType;
  @IsString() @MinLength(2) @MaxLength(200) name: string;
}
