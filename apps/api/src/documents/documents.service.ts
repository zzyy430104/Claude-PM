import { BadRequestException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess } from '../projects/access.service.js';

/** 项目文档标准目录（8.1.3.1.3 a：标准化的文件夹结构） */
export const DOCUMENT_FOLDERS = [
  '01-合同与投标', '02-项目计划', '03-设计与开发', '04-采购与供方', '05-制造与检验',
  '06-评审记录', '07-变更与配置', '08-交付与验收', '09-质保与关闭', '99-其他',
] as const;

const BLOCKED_EXT = new Set(['.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.ps1', '.sh', '.js', '.jar', '.vbs', '.dll', '.html', '.htm', '.svg']);
export const MAX_FILE_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 25) * 1024 * 1024;

const storageRoot = () => resolve(process.env.STORAGE_DIR ?? './storage');

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** 文档管理：按标准目录归档，每次上传生成新版本，历史版本不可修改和删除 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
  ) {}

  async list(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    const docs = await this.prisma.document.findMany({
      where: { projectId, tenantId: ctx.tenantId },
      orderBy: [{ folder: 'asc' }, { name: 'asc' }],
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    return docs.map(({ versions, ...d }) => ({ ...d, latest: versions[0] ? { fileName: versions[0].fileName, size: versions[0].size, uploadedAt: versions[0].uploadedAt, sha256: versions[0].sha256 } : null }));
  }

  async versions(actor: AuthUser, projectId: string, documentId: string) {
    const ctx = await this.access.load(actor, projectId);
    await this.findDoc(ctx.tenantId, projectId, documentId);
    return this.prisma.documentVersion.findMany({
      where: { documentId, tenantId: ctx.tenantId },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, fileName: true, mimeType: true, size: true, sha256: true, comment: true, uploadedById: true, uploadedAt: true },
    });
  }

  async upload(actor: AuthUser, projectId: string, file: UploadedFileLike | undefined, meta: { folder: string; name?: string; comment?: string; description?: string }) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    if (!ctx.member && !ctx.isManager) throw new ForbiddenException('Project members only');
    if (!file || file.size === 0) throw new BadRequestException('A non-empty file is required');
    if (file.size > MAX_FILE_BYTES) throw new PayloadTooLargeException('File is too large');
    if (!(DOCUMENT_FOLDERS as readonly string[]).includes(meta.folder)) throw new BadRequestException('Unknown document folder');

    // multer 按 latin1 解码文件名，这里还原为 UTF-8，并去掉路径部分
    const fileName = basename(Buffer.from(file.originalname, 'latin1').toString('utf8')).slice(0, 200);
    if (BLOCKED_EXT.has(extname(fileName).toLowerCase())) throw new BadRequestException('This file type is not allowed');
    const name = (meta.name?.trim() || fileName).slice(0, 200);

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const dir = join(storageRoot(), ctx.tenantId, projectId);
    const storagePath = join(ctx.tenantId, projectId, randomUUID());
    await mkdir(dir, { recursive: true });
    await writeFile(join(storageRoot(), storagePath), file.buffer, { flag: 'wx' });

    const existing = await this.prisma.document.findUnique({ where: { projectId_folder_name: { projectId, folder: meta.folder, name } } });
    return this.audit.tx(
      actor,
      {
        action: existing ? 'document.newVersion' : 'document.create',
        entity: 'Document',
        entityId: (r) => r.doc.id,
        after: (r) => ({ folder: meta.folder, name, version: r.version, sha256, size: file.size }),
      },
      async (tx) => {
        const doc = existing
          ? await tx.document.update({ where: { id: existing.id }, data: { currentVersion: { increment: 1 } } })
          : await tx.document.create({ data: { tenantId: ctx.tenantId, projectId, folder: meta.folder, name, description: meta.description, createdById: actor.id } });
        const version = await tx.documentVersion.create({
          data: {
            tenantId: ctx.tenantId, documentId: doc.id, version: doc.currentVersion, fileName, mimeType: file.mimetype || 'application/octet-stream',
            size: file.size, sha256, storagePath, comment: meta.comment, uploadedById: actor.id,
          },
        });
        return { doc, version: version.version };
      },
    ).then((r) => ({ ...r.doc, version: r.version }));
  }

  async open(actor: AuthUser, projectId: string, documentId: string, version?: number) {
    const ctx = await this.access.load(actor, projectId);
    const doc = await this.findDoc(ctx.tenantId, projectId, documentId);
    const v = await this.prisma.documentVersion.findFirst({ where: { documentId, tenantId: ctx.tenantId, version: version ?? doc.currentVersion } });
    if (!v) throw new NotFoundException('Version not found');
    return { meta: v, stream: createReadStream(join(storageRoot(), v.storagePath)) };
  }

  private async findDoc(tenantId: string, projectId: string, id: string) {
    const doc = await this.prisma.document.findFirst({ where: { id, projectId, tenantId } });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }
}
