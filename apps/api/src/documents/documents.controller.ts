import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import { DOCUMENT_FOLDERS, DocumentsService, MAX_FILE_BYTES, UploadedFileLike } from './documents.service.js';

class UploadMeta {
  @IsString() folder: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

@Controller('projects/:id/documents')
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Get('folders') folders() { return DOCUMENT_FOLDERS; }
  @Get() list(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.docs.list(u, id); }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  upload(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: UploadedFileLike | undefined, @Body() meta: UploadMeta) {
    return this.docs.upload(u, id, file, meta);
  }

  @Get(':did/versions') versions(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('did', ParseUUIDPipe) did: string) { return this.docs.versions(u, id, did); }

  @Get(':did/download')
  async download(
    @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('did', ParseUUIDPipe) did: string,
    @Res({ passthrough: true }) res: Response, @Query('version', new ParseIntPipe({ optional: true })) version?: number,
  ) {
    const { meta, stream } = await this.docs.open(u, id, did, version);
    res.set({
      'Content-Type': meta.mimeType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(meta.fileName)}`,
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(stream);
  }
}
