import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { verifyPassword } from '../common/password.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { LoginDto, SignupDto } from './dto.js';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

// 占位哈希：用户不存在时也做一次比较，避免通过耗时枚举账号
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly tenants: TenantsService,
  ) {}

  async signup(dto: SignupDto) {
    if (process.env.ALLOW_TENANT_SIGNUP !== 'true') {
      throw new ForbiddenException('Tenant signup is disabled');
    }
    const { tenant } = await this.tenants.create(
      {
        name: dto.tenantName,
        slug: dto.tenantSlug,
        adminEmail: dto.adminEmail,
        adminName: dto.adminName,
        adminPassword: dto.password,
      },
      null,
    );
    return { tenantId: tenant.id, slug: tenant.slug };
  }

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();
    let tenantId: string | null = null;
    if (dto.tenantSlug) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { slug: dto.tenantSlug },
      });
      if (!tenant || !tenant.active) {
        await verifyPassword(dto.password, DUMMY_HASH);
        throw new UnauthorizedException('Invalid credentials');
      }
      tenantId = tenant.id;
    }
    const user = await this.prisma.user.findFirst({
      where: { tenantId, email },
    });
    const ok = await verifyPassword(
      dto.password,
      user?.passwordHash ?? DUMMY_HASH,
    );
    if (!user || !user.active || !ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'auth.login',
      entity: 'User',
      entityId: user.id,
    });
    return this.issueTokens(user.id, user.tenantId, user.role);
  }

  /** 刷新令牌一次性使用：用旧换新，旧的立即作废 */
  async refresh(refreshToken: string) {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: { include: { tenant: true } } },
    });
    if (
      !record ||
      record.revokedAt ||
      record.expiresAt < new Date() ||
      !record.user.active ||
      (record.user.tenant && !record.user.tenant.active)
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return this.issueTokens(
      record.user.id,
      record.user.tenantId,
      record.user.role,
    );
  }

  async logout(userId: string, tenantId: string | null, refreshToken?: string) {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(refreshToken ? { tokenHash: sha256(refreshToken) } : {}),
      },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      tenantId,
      actorId: userId,
      action: 'auth.logout',
      entity: 'User',
      entityId: userId,
    });
  }

  private async issueTokens(
    userId: string,
    tenantId: string | null,
    role: string,
  ) {
    const accessToken = await this.jwt.signAsync({
      sub: userId,
      tid: tenantId,
      role,
    });
    const refreshToken = randomBytes(48).toString('hex');
    const days = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 7);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + days * 86_400_000),
      },
    });
    return { accessToken, refreshToken };
  }
}
