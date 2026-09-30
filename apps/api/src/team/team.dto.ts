import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { CommKind, TrainingStatus } from '../generated/prisma/enums.js';

export class ChannelDto {
  @IsString() @MinLength(1) @MaxLength(200) audience: string;
  @IsString() @MinLength(1) @MaxLength(200) channel: string;
  @IsString() @MinLength(1) @MaxLength(200) frequency: string;
  @IsOptional() @IsUUID() ownerId?: string;
}

export class UpdateCommPlanDto {
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ChannelDto) channels?: ChannelDto[];
  @IsOptional() @IsString() @MaxLength(10000) notes?: string;
}

export class CreateCommLogDto {
  @IsEnum(CommKind) kind: CommKind;
  @IsDateString() logDate: string;
  @IsString() @MinLength(1) @MaxLength(300) subject: string;
  @IsOptional() @IsString() @MaxLength(1000) participants?: string;
  @IsString() @MinLength(1) @MaxLength(10000) summary: string;
}

export class CreateTrainingDto {
  @IsUUID() userId: string;
  @IsString() @MinLength(1) @MaxLength(300) title: string;
  @IsOptional() @IsDateString() dueDate?: string;
}

export class UpdateTrainingDto {
  @IsOptional() @IsEnum(TrainingStatus) status?: TrainingStatus;
  @IsOptional() @IsDateString() dueDate?: string;
}
