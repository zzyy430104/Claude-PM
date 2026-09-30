import { IsDateString, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';

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
  /** 正数为发生成本，负数为冲销更正 */
  @IsNumber({ maxDecimalPlaces: 2 }) amount: number;
  @IsDateString() entryDate: string;
  @IsString() @MinLength(1) @MaxLength(500) description: string;
}
