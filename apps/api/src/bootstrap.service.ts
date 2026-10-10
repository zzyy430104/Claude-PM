import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Role } from './generated/prisma/enums.js';
import { hashPassword } from './common/password.js';
import { PrismaService } from './prisma/prisma.service.js';
import { withBypass } from './prisma/tenant-context.js';

/** 启动时的检查与引导：行级安全是否真的生效、首次启动创建平台管理员 */
@Injectable()
export class BootstrapService implements OnModuleInit {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.checkRowLevelSecurity();
    // 多进程时只由第一个进程创建平台管理员，避免并发重复创建
    if (process.env.PM_BOOTSTRAP !== '0') await withBypass(() => this.ensurePlatformAdmin());
  }

  /**
   * 超级用户和带 BYPASSRLS 的角色不受行级安全约束。
   * 生产环境必须用普通角色连接数据库；设置 REQUIRE_RLS=true 时，不满足就拒绝启动。
   */
  private async checkRowLevelSecurity() {
    const rows = await this.prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean; rolname: string }[]>`
      SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    const r = rows[0];
    if (!r || (!r.rolsuper && !r.rolbypassrls)) return;
    const msg = `Database role "${r.rolname}" bypasses row-level security (superuser or BYPASSRLS): tenant isolation relies on application code only`;
    if (process.env.REQUIRE_RLS === 'true') throw new Error(msg);
    this.logger.warn(msg);
  }

  /** 首次启动时按环境变量创建平台管理员（私有部署与云端均适用） */
  private async ensurePlatformAdmin() {
    const email = process.env.PLATFORM_ADMIN_EMAIL?.toLowerCase();
    const password = process.env.PLATFORM_ADMIN_PASSWORD;
    if (!email || !password) return;
    const exists = await this.prisma.user.findFirst({ where: { tenantId: null, role: Role.PLATFORM_ADMIN } });
    if (exists) return;
    await this.prisma.user.create({
      data: { tenantId: null, email, name: 'Platform Admin', passwordHash: await hashPassword(password), role: Role.PLATFORM_ADMIN },
    });
    this.logger.log(`Platform admin created: ${email}`);
  }
}
