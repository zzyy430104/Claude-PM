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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ChangeType, GateDecision, IssueStatus, ObjectiveMetric, RiskKind, RiskLevel3, RiskStatus } from '../generated/prisma/enums.js';

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
  /** 1 到企业设置的档数（3 或 5） */
  @IsInt() @Min(1) @Max(5) probability: number;
  @IsInt() @Min(1) @Max(5) impact: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) exposureAmount?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) responseCost?: number;
  @IsOptional() @IsString() @MaxLength(5000) costBenefitAnalysis?: string;
  @IsOptional() @IsUUID('all') ownerId?: string;
  @IsOptional() @IsString() @MaxLength(200) maturityLevel?: string;
  @IsOptional() @IsString() @MaxLength(500) functionalReviewers?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) budgetRecovery?: number;
  @IsOptional() @IsEnum(RiskLevel3) level?: RiskLevel3;
  @IsOptional() @IsUUID('all') workPackageId?: string;
  @IsOptional() @IsUUID('all') objectiveId?: string;
  @IsOptional() @IsString() @MaxLength(2000) cause?: string;
  @IsOptional() @IsString() @MaxLength(2000) effect?: string;
  @IsOptional() @IsString() @MaxLength(30) strategy?: string;
  @IsOptional() @IsString() @MaxLength(2000) acceptReason?: string;
  @IsOptional() @IsString() @MaxLength(2000) contingencyPlan?: string;
  @IsOptional() @IsString() @MaxLength(500) trigger?: string;
  @IsOptional() @IsInt() @Min(1) @Max(365) reviewCycleDays?: number;
}

export class UpdateRiskDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) probability?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) impact?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) exposureAmount?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) responseCost?: number;
  @IsOptional() @IsString() @MaxLength(5000) costBenefitAnalysis?: string;
  @IsOptional() @IsUUID('all') ownerId?: string;
  @IsOptional() @IsEnum(RiskStatus) status?: RiskStatus;
  @IsOptional() @IsString() @MaxLength(2000) closureNote?: string;
  @IsOptional() @IsBoolean() reviewed?: boolean;
  @IsOptional() @IsString() @MaxLength(200) maturityLevel?: string;
  @IsOptional() @IsString() @MaxLength(500) functionalReviewers?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) budgetRecovery?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID('all') workPackageId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID('all') objectiveId?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) cause?: string;
  @IsOptional() @IsString() @MaxLength(2000) effect?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(30) strategy?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) acceptReason?: string;
  @IsOptional() @IsString() @MaxLength(2000) contingencyPlan?: string;
  @IsOptional() @IsString() @MaxLength(500) trigger?: string;
  @IsOptional() @IsInt() @Min(1) @Max(365) reviewCycleDays?: number;
  /** 企业级风险：受影响的项目 */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) projectIds?: string[];
}

export class EnterpriseRiskDto extends CreateRiskDto {
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) projectIds?: string[];
}
export class ReviewRiskDto {
  @IsInt() @Min(1) @Max(5) probability: number;
  @IsInt() @Min(1) @Max(5) impact: number;
  @IsString() @MinLength(1) @MaxLength(2000) note: string;
  /** 预警已解除 */
  @IsOptional() @IsBoolean() clearTrigger?: boolean;
}
export class CloseRiskDto {
  @IsInt() @Min(1) @Max(5) residualProbability: number;
  @IsInt() @Min(1) @Max(5) residualImpact: number;
  @IsString() @MaxLength(2000) note: string;
}
export class OccurredDto {
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
export class EscalateRiskDto {
  @IsOptional() @IsUUID('all') ownerId?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
export class MeasureDto {
  @IsString() @MinLength(1) @MaxLength(300) title: string;
  @IsOptional() @IsUUID('all') ownerId?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) cost?: number;
}

export class IssueListQuery {
  @IsOptional() @IsEnum(IssueStatus) status?: IssueStatus;
}

export class ObjectiveDto {
  @IsString() @MinLength(1) @MaxLength(20) dimension: string;
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsString() @MinLength(1) @MaxLength(300) target: string;
  @IsOptional() @IsEnum(ObjectiveMetric) metric?: ObjectiveMetric;
}
export class UpdateObjectiveDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(20) dimension?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) target?: string;
  @IsOptional() @IsString() @MaxLength(300) current?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsEnum(['GREEN', 'AMBER', 'RED']) manualState?: 'GREEN' | 'AMBER' | 'RED' | null;
}
