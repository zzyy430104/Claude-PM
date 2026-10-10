import { Controller, Get, Param, ParseUUIDPipe, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import { EvidenceService } from './evidence.service.js';

@Controller('projects/:id/evidence-pack')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Get()
  async download(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const { stream, fileName } = await this.evidence.build(u, id);
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${fileName}"`, 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(stream);
  }
}
