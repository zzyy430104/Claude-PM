import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { InspectionResult, NcSeverity, NcSource, NcStatus } from '../generated/prisma/enums.js';

export class QualityActivityDto {
  @IsIn(['QA', 'QC']) kind: 'QA' | 'QC';
  @IsString() @MinLength(1) @MaxLength(300) name: string;
  @IsOptional() @IsUUID() phaseId?: string;
  @IsOptional() @IsString() @MaxLength(300) method?: string;
  @IsOptional() @IsString() @MaxLength(200) frequency?: string;
  @IsOptional() @IsUUID() responsibleId?: string;
}

export class UpdateQualityPlanDto {
  @IsOptional() @IsString() @MaxLength(10000) objectives?: string;
  @IsOptional() @IsString() @MaxLength(10000) procedures?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => QualityActivityDto)
  activities?: QualityActivityDto[];
}

export class CreateNcDto {
  @IsString() @MinLength(2) @MaxLength(300) title: string;
  @IsString() @MinLength(1) @MaxLength(5000) description: string;
  @IsEnum(NcSeverity) severity: NcSeverity;
  @IsEnum(NcSource) source: NcSource;
  @IsOptional() @IsUUID() phaseId?: string;
  @IsOptional() @IsUUID() workPackageId?: string;
}

export class UpdateNcDto {
  @IsOptional() @IsString() @MaxLength(5000) containment?: string;
  @IsOptional() @IsString() @MaxLength(5000) rootCause?: string;
  @IsOptional() @IsString() @MaxLength(5000) correctiveAction?: string;
  @IsOptional() @IsString() @MaxLength(5000) preventiveAction?: string;
  @IsOptional() @IsUUID() actionOwnerId?: string;
  @IsOptional() @IsDateString() actionDueDate?: string;
  @IsOptional() @IsUUID() changeRequestId?: string;
}

export class NcTransitionDto {
  @IsEnum(NcStatus) to: NcStatus;
  @IsOptional() @IsString() @MaxLength(5000) note?: string;
}

export class InspectionItemDto {
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsString() @MinLength(1) @MaxLength(30) category: string;
  @IsOptional() @IsString() @MaxLength(1000) requirement?: string;
  @IsOptional() @IsString() @MaxLength(300) method?: string;
  @IsOptional() @IsString() @MaxLength(300) record?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID('all') verifierId?: string | null;
  @IsOptional() @IsBoolean() isKey?: boolean;
}
export class UpdateInspectionItemDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(30) category?: string;
  @IsOptional() @IsString() @MaxLength(1000) requirement?: string;
  @IsOptional() @IsString() @MaxLength(300) method?: string;
  @IsOptional() @IsString() @MaxLength(300) record?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID('all') verifierId?: string | null;
  @IsOptional() @IsBoolean() isKey?: boolean;
}
export class InspectionResultDto {
  @IsEnum(InspectionResult) result: InspectionResult;
  @IsOptional() @IsString() @MaxLength(200) recordNo?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
export class FromTemplateDto {
  @IsUUID('all') templateId: string;
}
export class InspectionTemplateDto {
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsString() @MinLength(1) @MaxLength(30) category: string;
  @IsOptional() @IsString() @MaxLength(1000) requirement?: string;
  @IsOptional() @IsString() @MaxLength(300) method?: string;
  @IsOptional() @IsString() @MaxLength(300) record?: string;
}
export class UpdateInspectionTemplateDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(30) category?: string;
  @IsOptional() @IsString() @MaxLength(1000) requirement?: string;
  @IsOptional() @IsString() @MaxLength(300) method?: string;
  @IsOptional() @IsString() @MaxLength(300) record?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
