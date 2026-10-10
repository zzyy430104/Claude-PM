import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';

export class CreateCostAccountDto {
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/) code: string;
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) budget: number;
}

export class UpdateCostAccountDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) budget?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) estimateToComplete?: number;
}

export class CreateCostEntryDto {
  @IsString() accountId: string;
  @IsOptional() @IsUUID() workPackageId?: string;
  /** 正数为发生成本，负数为冲销更正 */
  @IsNumber({ maxDecimalPlaces: 2 }) amount: number;
  @IsDateString() entryDate: string;
  @IsString() @MinLength(1) @MaxLength(500) description: string;
}

export class WpCostLineDto {
  @IsUUID('all') accountId: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) amount: number;
}
/** 工作包预算：人天 × 费率（为空用职能角色标准费率）+ 费用行 */
export class WpCostDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) personDays?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) laborRate?: number | null;
  @IsOptional() @IsString() @MaxLength(500) laborRateReason?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => WpCostLineDto) lines?: WpCostLineDto[];
}
export class WpEtcDto {
  @ValidateIf((_, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) etc: number | null;
}
export class CommitmentDto {
  @IsUUID('all') accountId: string;
  @IsOptional() @IsUUID('all') workPackageId?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) amount: number;
  @IsDateString() entryDate: string;
  @IsString() @MinLength(1) @MaxLength(500) description: string;
}
