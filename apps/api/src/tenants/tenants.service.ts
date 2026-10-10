import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { hashPassword } from '../common/password.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DEFAULT_LIBRARY } from '../initiations/plan-templates.js';

/** 新企业默认的职能角色，企业可以改名、增加或停用 */
export const DEFAULT_FUNCTIONAL_ROLES = ['项目经理', '技术', '设计', '工艺', '质量', '生产', '采购', '计划', '物流', '仓库', '售后'];
/** 职能角色标准费率（元 / 人天）默认值 */
export const DEFAULT_RATES: Record<string, number> = { 项目经理: 1600, 技术: 1400, 设计: 1400, 工艺: 1200, 质量: 1200, 生产: 800, 采购: 1000, 计划: 1000, 物流: 800, 仓库: 700, 售后: 900 };
/** 企业检验项库默认内容 */
export const DEFAULT_INSPECTIONS = [
  { name: '尺寸检验', category: '产品', requirement: '图纸尺寸及公差', method: '卡尺 / 三坐标', record: '检验报告' },
  { name: '焊缝检验', category: '产品', requirement: 'EN 15085-2 对应等级', method: 'VT / MT / UT', record: '焊缝检验报告' },
  { name: '材质证明审核', category: '文件', requirement: 'EN 10204 3.1', method: '审核证书', record: '材质证明' },
  { name: '特殊过程确认', category: '过程', requirement: '焊接、涂装、粘接工艺评定有效', method: 'WPS / PQR 审核', record: '工艺评定记录' },
  { name: '设计评审', category: '评审', requirement: '输入输出一致，问题已关闭', method: '评审会', record: '评审记录' },
  { name: '型式试验', category: '试验', requirement: '按技术协议试验大纲', method: '第三方试验', record: '试验报告' },
  { name: '供应商首件', category: '产品', requirement: '供方 FAI 合格', method: '来料检验', record: '供方 FAI 报告' },
  { name: '客户确认', category: '评审', requirement: '客户书面确认', method: '签字确认单', record: '确认单' },
];

export interface CreateTenantInput {
  name: string;
  slug: string;
  adminEmail: string;
  adminName: string;
  adminPassword: string;
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** 创建租户及其首个租户管理员，同事务写审计 */
  async create(input: CreateTenantInput, actorId: string | null) {
    const passwordHash = await hashPassword(input.adminPassword);
    try {
      return await this.prisma.txn(async (tx) => {
        const tenant = await tx.tenant.create({
          data: { name: input.name, slug: input.slug },
        });
        await tx.functionalRole.createMany({
          data: DEFAULT_FUNCTIONAL_ROLES.map((name, i) => ({ tenantId: tenant.id, name, sortOrder: i + 1, rate: DEFAULT_RATES[name] ?? 0 })),
        });
        await tx.optionalWorkPackage.createMany({ data: DEFAULT_LIBRARY.map((l) => ({ ...l, tenantId: tenant.id })) });
        await tx.inspectionTemplate.createMany({ data: DEFAULT_INSPECTIONS.map((l) => ({ ...l, tenantId: tenant.id })) });
        const admin = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email: input.adminEmail.toLowerCase(),
            name: input.adminName,
            passwordHash,
            mustChangePassword: actorId !== null,
            role: Role.TENANT_ADMIN,
          },
        });
        await this.audit.record(
          {
            tenantId: tenant.id,
            actorId,
            action: 'tenant.create',
            entity: 'Tenant',
            entityId: tenant.id,
            after: { slug: tenant.slug, name: tenant.name },
          },
          tx,
        );
        await this.audit.record(
          {
            tenantId: tenant.id,
            actorId,
            action: 'user.create',
            entity: 'User',
            entityId: admin.id,
            after: { email: admin.email, role: admin.role },
          },
          tx,
        );
        return { tenant, adminId: admin.id };
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Tenant slug already exists');
      }
      throw e;
    }
  }

  list() {
    return this.prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async setActive(id: string, active: boolean, actorId: string) {
    const existing = await this.prisma.tenant.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tenant not found');
    return this.prisma.txn(async (tx) => {
      const tenant = await tx.tenant.update({ where: { id }, data: { active } });
      await this.audit.record(
        {
          tenantId: id,
          actorId,
          action: 'tenant.update',
          entity: 'Tenant',
          entityId: id,
          before: { active: existing.active },
          after: { active },
        },
        tx,
      );
      return tenant;
    });
  }
}
