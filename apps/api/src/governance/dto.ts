import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ChangeType, GateDecision, IssueStatus, RiskKind, RiskStatus } from '../generated/prisma/enums.js';

export class ChecklistResultDto {
  @IsString() @MaxLength(500) item: string;
  @IsBoolean() passed: boolean;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}

export class UpdateGateDto {
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ChecklistResultDto)
  checklistResults?: ChecklistResultDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) attendees?: string[];
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
}

export class ActionInputDto {
  @IsString() @MinLength(1) @MaxLength(300) title: string;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}

export class GateDecisionDto {
  @IsEnum(GateDecision) decision: GateDecision;
  @IsString() @MinLength(1) @MaxLength(5000) note: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ActionInputDto)
  actions?: ActionInputDto[];
}

export class AuthorizeOverrideDto {
  @IsString() @MinLength(5) @MaxLength(2000) reason: string;
}

export class CreateProjectReviewDto {
  @IsDateString() reviewDate: string;
  @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) attendees: string[];
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @IsOptional() @IsString() @MaxLength(5000) escalations?: string;
  @IsOptional() @IsUUID() reportedToId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ActionInputDto)
  actions?: ActionInputDto[];
}

export class CreateIssueDto {
  @IsString() @MinLength(1) @MaxLength(300) title: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsEnum(['ISSUE', 'ACTION']) kind?: 'ISSUE' | 'ACTION';
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}

export class UpdateIssueDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) title?: string;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsEnum(IssueStatus) status?: IssueStatus;
  @IsOptional() @IsString() @MaxLength(2000) closureNote?: string;
}

export class TechnicalImpactDto {
  @IsString() @MinLength(1) deliveredParts: string;
  @IsString() @MinLength(1) customerSpec: string;
  @IsString() @MinLength(1) documents: string;
  @IsString() @MinLength(1) requirements: string;
  @IsString() @MinLength(1) revalidation: string;
}

export class ProposedChangeDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) budget?: number;
  @IsOptional() @IsDateString() customerDeliveryDate?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
}

export class CreateChangeDto {
  @IsEnum(ChangeType) type: ChangeType;
  @IsString() @MinLength(2) @MaxLength(300) title: string;
  @IsString() @MinLength(1) @MaxLength(5000) description: string;
  @IsString() @MinLength(1) @MaxLength(5000) reason: string;
  @IsOptional() @IsBoolean() triggeredByFailure?: boolean;
  @IsOptional() @IsString() @MaxLength(5000) causeAnalysis?: string;
  @IsOptional() @IsString() @MaxLength(5000) impactAnalysis?: string;
  @IsOptional() @IsString() @MaxLength(5000) verificationPlan?: string;
  @IsOptional() @ValidateNested() @Type(() => TechnicalImpactDto) technicalImpact?: TechnicalImpactDto;
  @IsOptional() @ValidateNested() @Type(() => ProposedChangeDto) proposed?: ProposedChangeDto;
}

export class UpdateChangeDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsString() @MaxLength(5000) reason?: string;
  @IsOptional() @IsBoolean() triggeredByFailure?: boolean;
  @IsOptional() @IsString() @MaxLength(5000) causeAnalysis?: string;
  @IsOptional() @IsString() @MaxLength(5000) impactAnalysis?: string;
  @IsOptional() @IsString() @MaxLength(5000) verificationPlan?: string;
  @IsOptional() @ValidateNested() @Type(() => TechnicalImpactDto) technicalImpact?: TechnicalImpactDto;
  @IsOptional() @ValidateNested() @Type(() => ProposedChangeDto) proposed?: ProposedChangeDto;
}

export class ChangeNoteDto {
  @IsOptional() @IsString() @MaxLength(5000) note?: string;
}

export class RequiredNoteDto {
  @IsString() @MinLength(1) @MaxLength(5000) note: string;
}

export class CustomerContactDto {
  /** 通知客户的日期，缺省为今天 */
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsBoolean() agreed?: boolean;
}

export class CreateRiskDto {
  @IsEnum(RiskKind) kind: RiskKind;
  @IsString() @MinLength(2) @MaxLength(300) title: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsInt() @Min(1) @Max(5) probability: number;
  @IsInt() @Min(1) @Max(5) impact: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) exposureAmount: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) responseCost: number;
  @IsString() @MinLength(2) @MaxLength(5000) costBenefitAnalysis: string;
  @IsOptional() @IsUUID() ownerId?: string;
}

export class UpdateRiskDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) probability?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) impact?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) exposureAmount?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) responseCost?: number;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(5000) costBenefitAnalysis?: string;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsEnum(RiskStatus) status?: RiskStatus;
  @IsOptional() @IsString() @MaxLength(2000) closureNote?: string;
  @IsOptional() @IsBoolean() reviewed?: boolean;
}

export class IssueListQuery {
  @IsOptional() @IsEnum(IssueStatus) status?: IssueStatus;
}
