import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { FaiResult } from '../generated/prisma/enums.js';

export class PurchaseItemDto {
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsOptional() @IsString() @MaxLength(200) supplier?: string;
  @IsOptional() @IsString() @MaxLength(100) quantity?: string;
  @IsOptional() @IsDateString() needDate?: string;
  @IsOptional() @IsDateString() orderBy?: string;
  @IsOptional() @IsBoolean() longLead?: boolean;
  @IsOptional() @IsUUID('all') workPackageId?: string;
  @IsOptional() @IsUUID('all') accountId?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) amount?: number;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
export class UpdatePurchaseItemDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(200) supplier?: string;
  @IsOptional() @IsString() @MaxLength(100) quantity?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() needDate?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() orderBy?: string | null;
  @IsOptional() @IsBoolean() longLead?: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID('all') workPackageId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID('all') accountId?: string | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) amount?: number;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
export class OrderDto {
  @IsOptional() @IsString() @MaxLength(100) orderNo?: string;
  @IsOptional() @IsDateString() orderedAt?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) amount?: number;
  @IsOptional() @IsUUID('all') accountId?: string;
}
export class ReceiveDto {
  @IsInt() @Min(0) @Max(100) receivedPct: number;
  @IsOptional() @IsDateString() date?: string;
}
export class SettleDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) amount?: number;
  @IsOptional() @IsDateString() date?: string;
}
export class FaiDto {
  @IsString() @MinLength(1) @MaxLength(60) reportNo: string;
  @IsDateString() date: string;
  @IsString() @MinLength(1) @MaxLength(200) part: string;
  @IsEnum(FaiResult) result: FaiResult;
  @IsOptional() @IsBoolean() witnessed?: boolean;
  @IsOptional() @IsString() @MaxLength(100) witness?: string;
  @IsOptional() @IsString() @MaxLength(500) location?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  /** 遗留项：每项生成一个行动项 */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(300, { each: true }) openPoints?: string[];
  @IsOptional() @IsUUID('all') ownerId?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}
export class UpdateFaiDto {
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) part?: string;
  @IsOptional() @IsEnum(FaiResult) result?: FaiResult;
  @IsOptional() @IsBoolean() witnessed?: boolean;
  @IsOptional() @IsString() @MaxLength(100) witness?: string;
  @IsOptional() @IsString() @MaxLength(500) location?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
export class HandoverDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() date?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsUUID('all') receiverId?: string | null;
  @IsOptional() @IsString() @MaxLength(100) externalName?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() warrantyFrom?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() warrantyTo?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(60, { each: true }) documents?: string[];
  @IsOptional() @IsString() @MaxLength(5000) openIssues?: string;
}
export class ConfirmHandoverDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
