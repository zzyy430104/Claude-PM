import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { LessonKind } from '../generated/prisma/enums.js';

export class CreateLessonDto {
  @IsEnum(LessonKind) kind: LessonKind;
  @IsString() @MinLength(2) @MaxLength(300) title: string;
  @IsString() @MinLength(1) @MaxLength(5000) description: string;
  @IsString() @MinLength(1) @MaxLength(5000) recommendation: string;
  @IsOptional() @IsUUID() phaseId?: string;
}

export class CloseProjectDto {
  /** 没有登记经验教训时必须说明原因 */
  @IsOptional() @IsString() @MinLength(5) @MaxLength(2000) noLessonsReason?: string;
}
