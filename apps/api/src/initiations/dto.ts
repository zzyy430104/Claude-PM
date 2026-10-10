import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { ApprovalRoleKind, ProjectType, RiskLevel } from '../generated/prisma/enums.js';
import { PartialRequirementsDto, RequirementsDto } from './requirements.js';

const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/;

export class SaveInitiationDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) name?: string;
  @IsOptional() @ValidateIf((_, v) => v !== '') @Matches(CODE, { message: 'invalid project code' }) projectCode?: string;
  @IsOptional() @IsEnum(ProjectType) type?: ProjectType;
  @IsOptional() @IsEnum(RiskLevel) riskLevel?: RiskLevel;
  @IsOptional() @IsString() @MaxLength(100) productFamily?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() proposedPmId?: string | null;
  @IsOptional() @IsString() @MaxLength(200) customer?: string;
  @IsOptional() @IsString() @MaxLength(100) contractNo?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) contractAmount?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() startDate?: string | null;
  @IsOptional() @ValidateNested() @Type(() => RequirementsDto) requirements?: RequirementsDto;
}

export class OpinionDto {
  @IsBoolean() agree: boolean;
  @IsString() @MinLength(1) @MaxLength(2000) opinion: string;
}

export class DecisionDto {
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class AssignmentDto {
  @IsUUID('all') userId: string;
  @IsOptional() @IsString() @MaxLength(200) basis?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() validFrom?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() validTo?: string | null;
}
export class ReplaceAssignmentsDto {
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => AssignmentDto) entries: AssignmentDto[];
}
export const APPROVAL_KINDS = Object.values(ApprovalRoleKind);

export class SaveRequirementChangeDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) reason?: string;
  @IsOptional() @IsEnum(ProjectType) type?: ProjectType;
  @IsOptional() @ValidateNested() @Type(() => PartialRequirementsDto) requirements?: PartialRequirementsDto;
}

export class OptionalWpDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsInt() @Min(0) @Max(3650) durationDays: number;
  @IsOptional() @IsString() @MaxLength(100) suggestedPhase?: string;
  @IsOptional() @IsString() @MaxLength(30) roleName?: string;
  @IsOptional() @IsString() @MaxLength(200) deliverable?: string;
  @IsOptional() @IsArray() @IsEnum(ProjectType, { each: true }) types?: ProjectType[];
}
export class UpdateOptionalWpDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(3650) durationDays?: number;
  @IsOptional() @IsString() @MaxLength(100) suggestedPhase?: string;
  @IsOptional() @IsString() @MaxLength(30) roleName?: string;
  @IsOptional() @IsString() @MaxLength(200) deliverable?: string;
  @IsOptional() @IsArray() @IsEnum(ProjectType, { each: true }) types?: ProjectType[];
  @IsOptional() @IsBoolean() active?: boolean;
}
export class AddFromLibraryDto {
  @IsUUID() libraryId: string;
  /** 放到哪个一级工作包（阶段）下面 */
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsUUID() changeRequestId?: string;
}
export class AssignByRoleDto {
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => RoleOwnerDto) assignments: RoleOwnerDto[];
  /** true：已有责任人的也改；默认只填空的 */
  @IsOptional() @IsBoolean() overwrite?: boolean;
}
export class RoleOwnerDto {
  @IsUUID() functionalRoleId: string;
  @IsUUID('all') userId: string;
}
