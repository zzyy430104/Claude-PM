import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { Role } from '../generated/prisma/enums.js';
import { CurrentUser, Roles } from '../common/decorators.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { loadAiConfig, type Scenario } from './ai-config.js';
import { AiService } from './ai.service.js';
import { extractText } from './extract.js';

class DraftDto {
  @IsOptional() @IsUUID('all') projectId?: string;
  @IsObject() input: Record<string, unknown>;
}
class AdoptDto {
  @IsBoolean() adopted: boolean;
  @IsOptional() @IsString() @MaxLength(40) entityType?: string;
  @IsOptional() @IsUUID('all') entityId?: string;
}
/** PUT /ai-settings 的请求体：字段都可选，只改传进来的；未知字段会被全局 ValidationPipe 拒绝 */
class AiSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(500) baseUrl?: string;
  @IsOptional() @IsString() @MaxLength(100) model?: string;
  @IsOptional() @IsObject() scenarios?: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000) perUserDaily?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000) perTenantDaily?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000) maxFileMb?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000) maxInputChars?: number;
  /** 不传：不修改；null 或空串：删除；字符串：设置新密钥 */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(500) apiKey?: string | null;
}
type Upload = { originalname: string; buffer: Buffer; mimetype: string; size: number };

/** AI 辅助：设置、起草、采纳、使用记录 */
@Controller()
export class AiController {
  constructor(private readonly ai: AiService, private readonly prisma: PrismaService) {}

  @Get('ai/status') status(@CurrentUser() u: AuthUser) { return this.ai.status(u); }
  @Get('ai-settings') @Roles(Role.TENANT_ADMIN) settings(@CurrentUser() u: AuthUser) { return this.ai.getSettings(u); }
  @Put('ai-settings') @Roles(Role.TENANT_ADMIN) save(@CurrentUser() u: AuthUser, @Body() body: AiSettingsDto) { return this.ai.saveSettings(u, body); }
  @Post('ai-settings/test') @HttpCode(200) @Roles(Role.TENANT_ADMIN) test(@CurrentUser() u: AuthUser) { return this.ai.test(u); }

  @Post('ai/draft/:scenario') @HttpCode(200)
  draft(@CurrentUser() u: AuthUser, @Param('scenario') s: string, @Body() dto: DraftDto) { return this.ai.draft(u, s as Scenario, dto.input, dto.projectId); }

  /** 带文件的起草（合同、技术协议、库存计划）：先取出文字，再起草 */
  @Post('ai/draft-file/:scenario') @HttpCode(200)
  @UseInterceptors(FilesInterceptor('files', 5, { limits: { fileSize: 20 * 1024 * 1024 } }))
  async draftFile(@CurrentUser() u: AuthUser, @Param('scenario') s: string, @UploadedFiles() files: Upload[], @Body() body: Record<string, string>) {
    if (!files?.length) throw new BadRequestException('Upload at least one file');
    const { config } = await loadAiConfig(this.prisma, requireTenantId(u));
    if (files.some((f) => f.size > config.maxFileMb * 1024 * 1024)) throw new BadRequestException({ code: 'AI_FILE_TOO_LARGE', message: `Files must be under ${config.maxFileMb} MB` });
    const parts: string[] = [];
    for (const f of files) parts.push(`===== 文件：${Buffer.from(f.originalname, 'latin1').toString('utf8')} =====\n${await extractText(f)}`);
    const text = parts.join('\n\n');
    if (text.length > config.maxInputChars) throw new BadRequestException({ code: 'AI_INPUT_TOO_LONG', message: `The files contain ${text.length} characters (limit ${config.maxInputChars})` });
    let extra: Record<string, unknown> = {};
    try { extra = body.input ? (JSON.parse(body.input) as Record<string, unknown>) : {}; } catch { throw new BadRequestException('input must be JSON'); }
    return this.ai.draft(u, s as Scenario, { ...extra, text }, body.projectId || undefined);
  }

  @Post('ai/usage/:id/adopt') @HttpCode(200) adopt(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdoptDto) { return this.ai.adopt(u, id, dto); }
  @Get('ai/provenance') provenance(@CurrentUser() u: AuthUser, @Query('entityType') t: string, @Query('ids') ids: string) { return this.ai.provenance(u, t ?? '', (ids ?? '').split(',').filter(Boolean)); }
  @Get('ai/usage') usage(@CurrentUser() u: AuthUser, @Query('days') days?: string) { return this.ai.usage(u, Math.min(Math.max(Number(days) || 30, 1), 365)); }
}
