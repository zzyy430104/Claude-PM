import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEmail, IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { CommentEntity, MeetingRecurrence, MeetingType, RsvpStatus } from '../generated/prisma/enums.js';

export class AttendeeDto {
  @IsOptional() @IsUUID('all') userId?: string;
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(100) org?: string;
  @IsOptional() @ValidateIf((_, v) => v !== '') @IsEmail() email?: string;
}
export class MeetingDto {
  @IsOptional() @IsEnum(MeetingType) type?: MeetingType;
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsDateString() startAt: string;
  @IsDateString() endAt: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
  @IsOptional() @IsString() @MaxLength(500) link?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(300, { each: true }) agenda?: string[];
  @IsOptional() @IsString() @MaxLength(2000) materials?: string;
  @IsOptional() @IsEnum(MeetingRecurrence) recurrence?: MeetingRecurrence;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => AttendeeDto) attendees?: AttendeeDto[];
}
export class UpdateMeetingDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsDateString() startAt?: string;
  @IsOptional() @IsDateString() endAt?: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
  @IsOptional() @IsString() @MaxLength(500) link?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(300, { each: true }) agenda?: string[];
  @IsOptional() @IsString() @MaxLength(2000) materials?: string;
  @IsOptional() @IsEnum(MeetingRecurrence) recurrence?: MeetingRecurrence;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => AttendeeDto) attendees?: AttendeeDto[];
}
export class RsvpDto {
  @IsIn([RsvpStatus.ACCEPTED, RsvpStatus.DECLINED]) response: RsvpStatus;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class ExternalRsvpDto {
  @IsIn([RsvpStatus.ACCEPTED, RsvpStatus.DECLINED]) response: RsvpStatus;
  @IsIn(['EMAIL', 'WECHAT', 'PHONE']) method: string;
}
export class MinuteActionDto {
  @IsString() @MaxLength(300) title: string;
  @IsOptional() @ValidateIf((_, v) => v !== '') @IsUUID('all') ownerId?: string;
  @IsOptional() @ValidateIf((_, v) => v !== '') @IsDateString() dueDate?: string;
}
export class MinutesDto {
  @IsString() @MaxLength(10000) points: string;
  @IsString() @MaxLength(10000) decisions: string;
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => MinuteActionDto) actions: MinuteActionDto[];
}
export class AnnouncementDto {
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsString() @MinLength(1) @MaxLength(10000) body: string;
  @IsOptional() @IsBoolean() requireRead?: boolean;
  /** 为空表示全项目组 */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) recipients?: string[];
}
export class CommentDto {
  @IsEnum(CommentEntity) entityType: CommentEntity;
  @IsUUID('all') entityId: string;
  @IsString() @MinLength(1) @MaxLength(5000) body: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) mentions?: string[];
}
export class CommentQuery {
  @IsEnum(CommentEntity) type: CommentEntity;
  @IsOptional() @IsUUID('all') entityId?: string;
}
