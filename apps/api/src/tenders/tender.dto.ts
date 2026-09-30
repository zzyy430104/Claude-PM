import { IsNumber, IsOptional, IsString, Matches, MaxLength, Min, MinLength, IsDateString, IsEnum } from 'class-validator';
import { RiskLevel } from '../generated/prisma/enums.js';

export class CreateTenderDto {
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/) code: string;
  @IsString() @MinLength(2) @MaxLength(300) title: string;
  @IsString() @MinLength(1) @MaxLength(200) customer: string;
}

export class UpdateTenderDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(200) customer?: string;
  @IsOptional() @IsString() @MaxLength(10000) requirements?: string;
  @IsOptional() @IsString() @MaxLength(10000) riskAssessment?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) riskExposure?: number;
  @IsOptional() @IsString() @MaxLength(10000) knowledgeInputs?: string;
  @IsOptional() @IsString() @MaxLength(10000) deliverablesPlan?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) estimatedCost?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) offerPrice?: number;
  @IsOptional() @IsString() @MaxLength(10000) resourcePlan?: string;
}

export class TenderDecisionDto {
  @IsString() @MinLength(1) @MaxLength(5000) note: string;
}

export class ConvertTenderDto {
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/) code: string;
  @IsEnum(RiskLevel) riskLevel: RiskLevel;
  @IsDateString() startDate: string;
  @IsDateString() endDate: string;
  @IsOptional() @IsDateString() customerDeliveryDate?: string;
}
