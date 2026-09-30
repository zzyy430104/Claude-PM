import { IsDateString, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { DeviationDimension } from '../generated/prisma/enums.js';

export class CreateSwotDto {
  @IsDateString() reviewDate: string;
  @IsString() @MinLength(2) @MaxLength(500) participants: string;
  @IsOptional() @IsString() @MaxLength(5000) strengths?: string;
  @IsOptional() @IsString() @MaxLength(5000) weaknesses?: string;
  @IsOptional() @IsString() @MaxLength(5000) opportunities?: string;
  @IsOptional() @IsString() @MaxLength(5000) threats?: string;
  @IsOptional() @IsString() @MaxLength(5000) actions?: string;
}

export class CreateDeviationDto {
  @IsEnum(DeviationDimension) dimension: DeviationDimension;
  @IsDateString() noticeDate: string;
  @IsString() @MinLength(2) @MaxLength(500) audience: string;
  @IsString() @MinLength(2) @MaxLength(5000) impact: string;
  @IsString() @MinLength(2) @MaxLength(5000) countermeasures: string;
}

const LEVEL = ['HIGH', 'MEDIUM', 'LOW'];
export class StakeholderDto {
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsOptional() @IsString() @MaxLength(200) organization?: string;
  @IsOptional() @IsString() @MaxLength(200) role?: string;
  @IsOptional() @IsIn(LEVEL) influence?: string;
  @IsOptional() @IsIn(LEVEL) interest?: string;
  @IsOptional() @IsString() @MaxLength(2000) expectations?: string;
  @IsOptional() @IsString() @MaxLength(2000) communication?: string;
}

export class UpdateStakeholderDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(200) organization?: string;
  @IsOptional() @IsString() @MaxLength(200) role?: string;
  @IsOptional() @IsIn(LEVEL) influence?: string;
  @IsOptional() @IsIn(LEVEL) interest?: string;
  @IsOptional() @IsString() @MaxLength(2000) expectations?: string;
  @IsOptional() @IsString() @MaxLength(2000) communication?: string;
}
