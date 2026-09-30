import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Role } from './generated/prisma/enums.js';
import { hashPassword } from './common/password.js';
import { PrismaService } from './prisma/prisma.service.js';

/** 首次启动时按环境变量创建平台管理员（私有部署与云端均适用） */
@Injectable()
export class BootstrapService implements OnModuleInit {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const email = process.env.PLATFORM_ADMIN_EMAIL?.toLowerCase();
    const password = process.env.PLATFORM_ADMIN_PASSWORD;
    if (!email || !password) return;
    const exists = await this.prisma.user.findFirst({
      where: { tenantId: null, role: Role.PLATFORM_ADMIN },
    });
    if (exists) return;
    await this.prisma.user.create({
      data: {
        tenantId: null,
        email,
        name: 'Platform Admin',
        passwordHash: await hashPassword(password),
        role: Role.PLATFORM_ADMIN,
      },
    });
    this.logger.log(`Platform admin created: ${email}`);
  }
}
