import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  DeliverableKind,
  DeliverableStatus,
  ProjectRole,
  RiskLevel,
  WpStatus,
} from '../generated/prisma/enums.js';

const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

export class PhaseTemplatePhaseDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) checklist: string[];
  @IsArray() @IsEnum(ProjectRole, { each: true }) mandatoryRoles: ProjectRole[];
}

export class CreatePhaseTemplateDto {
  @IsString() @MinLength(2) @MaxLength(100) name: string;
  @IsArray() @ArrayMaxSize(30)
  @ValidateNested({ each: true }) @Type(() => PhaseTemplatePhaseDto)
  phases: PhaseTemplatePhaseDto[];
}

export class CreateProjectDto {
  @Matches(CODE, { message: 'invalid project code' }) code: string;
  @IsString() @MinLength(2) @MaxLength(200) name: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsEnum(RiskLevel) riskLevel: RiskLevel;
  @IsDateString() startDate: string;
  @IsDateString() endDate: string;
  @IsOptional() @IsDateString() customerDeliveryDate?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) budget?: number;
  @IsOptional() @IsUUID() templateId?: string;
  @IsOptional() @IsUUID() managerId?: string;
}

export class UpdateProjectDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsEnum(RiskLevel) riskLevel?: RiskLevel;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsDateString() customerDeliveryDate?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) budget?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) reviewIntervalDays?: number;
}

export class AddMemberDto {
  @IsUUID() userId: string;
  @IsEnum(ProjectRole) projectRole: ProjectRole;
  @IsOptional() @IsBoolean() isCcb?: boolean;
  @IsOptional() @IsString() @MaxLength(200) appointment?: string;
  @IsOptional() @IsString() @MaxLength(1000) competencies?: string;
}

export class UpdateMemberDto {
  @IsOptional() @IsEnum(ProjectRole) projectRole?: ProjectRole;
  @IsOptional() @IsBoolean() isCcb?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MaxLength(200) appointment?: string;
  @IsOptional() @IsString() @MaxLength(1000) competencies?: string;
}

export class UpdatePlanDto {
  @IsOptional() @IsString() @MaxLength(10000) objectives?: string;
  @IsOptional() @IsString() @MaxLength(10000) frameConditions?: string;
  @IsOptional() @IsString() @MaxLength(10000) exclusions?: string;
  @IsOptional() @IsString() @MaxLength(10000) responsibilities?: string;
  @IsOptional() @IsString() @MaxLength(10000) executionRules?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsObject({ each: true }) orgChart?: Record<string, unknown>[];
  @IsOptional() @IsObject() interfaces?: Record<string, unknown>;
}

export class UpdatePhaseDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) checklist?: string[];
  @IsOptional() @IsArray() @IsEnum(ProjectRole, { each: true }) mandatoryRoles?: ProjectRole[];
}

export class CreateWpDto {
  @Matches(CODE, { message: 'invalid code' }) code: string;
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsUUID() phaseId?: string;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsInt() @Min(1) @Max(3650) durationDays: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) budget?: number;
  @IsOptional() @IsUUID() changeRequestId?: string;
}

export class UpdateWpDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsUUID() phaseId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(3650) durationDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) percentComplete?: number;
  @IsOptional() @IsEnum(WpStatus) status?: WpStatus;
  @IsOptional() @IsDateString() actualStart?: string;
  @IsOptional() @IsDateString() actualEnd?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) budget?: number;
}

export class DeleteWpQuery {
  @IsOptional() @IsUUID() changeRequestId?: string;
}

export class AddDependencyDto {
  @IsUUID() predecessorId: string;
  @IsUUID() successorId: string;
}

export class CreateDeliverableDto {
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsEnum(DeliverableKind) kind: DeliverableKind;
  @IsOptional() @IsUUID() phaseId?: string;
  @IsOptional() @IsString() @MaxLength(200) supplier?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateDeliverableDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsEnum(DeliverableStatus) status?: DeliverableStatus;
  @IsOptional() @IsString() @MaxLength(200) supplier?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
