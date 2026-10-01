import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';

export class AspectDto {
  @Matches(/^[A-Z0-9_]{1,30}$/) key: string;
  @IsString() @MinLength(1) @MaxLength(20) name: string;
  @IsInt() @Min(0) @Max(100) weight: number;
}
export class AspectsDto {
  /** 为 null 时恢复企业默认 */
  @ValidateIf((_, v) => v !== null) @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => AspectDto) aspects: AspectDto[] | null;
  @IsString() @MinLength(1) @MaxLength(500) reason: string;
}
export class PmEvaluationDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() actualDelivery?: string | null;
  @IsOptional() @IsObject() manualScores?: Record<string, number>;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(100) adjustedScore?: number | null;
  @IsOptional() @IsString() @MaxLength(500) adjustReason?: string;
}
export class MemberEvaluationDto {
  @IsObject() scores: Record<string, number>;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}
export class ReasonDto {
  @IsString() @MinLength(1) @MaxLength(500) reason: string;
}
export class SheetQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID('all') projectId?: string;
}
export class DepartmentDto {
  @IsString() @MinLength(1) @MaxLength(50) name: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID('all') headId?: string | null;
}
export class UpdateDepartmentDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(50) name?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID('all') headId?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}
