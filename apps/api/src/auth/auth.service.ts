import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { hashPassword, verifyPassword } from '../common/password.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { withBypass } from '../prisma/tenant-context.js';
import { limits, RateLimiter } from './rate-limiter.js';
import { ChangePasswordDto, LoginDto, SignupDto } from './dto.js';

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
    private readonly limiter: RateLimiter,
  ) {}

  signup(dto: SignupDto, ip: string) {
    return withBypass(() => this.doSignup(dto, ip));
  }

  private async doSignup(dto: SignupDto, ip: string) {
    const l = limits();
    await this.limiter.assertBelow(`signup|${ip}`, l.signupPerIp, 60 * 60_000);
    await this.limiter.record(`signup|${ip}`);
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

  async login(dto: LoginDto, ip: string) {
    const email = dto.email.toLowerCase();
    const l = limits();
    const accountKey = `login|${dto.tenantSlug ?? ''}|${email}`;
    const ipKey = `login-ip|${ip}`;
    await this.limiter.assertBelow(accountKey, l.loginPerAccount, l.windowMs);
    await this.limiter.assertBelow(ipKey, l.loginPerIp, l.windowMs);
    try {
      return await withBypass(() => this.doLogin(dto, email));
    } catch (e) {
      if (e instanceof UnauthorizedException) {
        await this.limiter.record(accountKey);
        await this.limiter.record(ipKey);
      }
      throw e;
    }
  }

  private async doLogin(dto: LoginDto, email: string) {
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
    await this.limiter.reset(`login|${dto.tenantSlug ?? ''}|${email}`);
    return this.issueTokens(user.id, user.tenantId, user.role);
  }

  /**
   * 刷新令牌一次性使用：用旧换新，旧的立即作废。
   * 多个标签页可能几乎同时拿同一个 Cookie 来刷新：旧令牌因轮换作废后的短暂宽限期内
   * （REFRESH_REUSE_GRACE_SECONDS，默认 30 秒）再次使用，仍签发一组新令牌，避免把用户登出。
   * 超过宽限期再用已轮换的令牌，抛出 RefreshTokenReusedError（不清 Cookie，浏览器里可能已是更新的令牌）。
   */
  refresh(refreshToken: string) {
    return withBypass(() => this.doRefresh(refreshToken));
  }

  private async doRefresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: { include: { tenant: true } } },
    });
    if (
      !record ||
      record.expiresAt < new Date() ||
      !record.user.active ||
      (record.user.tenant && !record.user.tenant.active)
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (record.revokedAt) {
      if (record.rotatedAt && this.withinGrace(record.rotatedAt) && !(await this.revokedAfter(record.userId, record.rotatedAt))) {
        return this.issueTokens(record.user.id, record.user.tenantId, record.user.role);
      }
      if (record.rotatedAt) throw new RefreshTokenReusedError();
      throw new UnauthorizedException('Invalid refresh token');
    }
    const now = new Date();
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: now, rotatedAt: now },
    });
    if (revoked.count === 0) {
      // 并发请求刚刚把它轮换掉：重新读取，按宽限期规则处理
      return this.doRefresh(refreshToken);
    }
    return this.issueTokens(
      record.user.id,
      record.user.tenantId,
      record.user.role,
    );
  }

  private withinGrace(rotatedAt: Date) {
    const sec = Number(process.env.REFRESH_REUSE_GRACE_SECONDS ?? 30);
    return Date.now() - rotatedAt.getTime() <= sec * 1000;
  }

  /** 轮换之后是否发生过登出 / 改密码等主动作废（这些作废不记 rotatedAt），发生过就不再给宽限 */
  private async revokedAfter(userId: string, since: Date) {
    const n = await this.prisma.refreshToken.count({
      where: { userId, rotatedAt: null, revokedAt: { gte: since } },
    });
    return n > 0;
  }

  /** 本人修改密码：校验当前密码，作废所有刷新令牌（其他设备下线），为当前会话签发新令牌 */
  async changePassword(actor: AuthUser, dto: ChangePasswordDto) {
    const l = limits();
    const key = `pwchange|${actor.id}`;
    await this.limiter.assertBelow(key, l.loginPerAccount, l.windowMs);
    const user = await withBypass(() => this.prisma.user.findUnique({ where: { id: actor.id } }));
    if (!user || !(await verifyPassword(dto.currentPassword, user.passwordHash))) {
      await this.limiter.record(key);
      throw new BadRequestException({ code: 'WRONG_PASSWORD', message: 'Current password is incorrect' });
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException({ code: 'SAME_PASSWORD', message: 'The new password must differ from the current one' });
    }
    const passwordHash = await hashPassword(dto.newPassword);
    await withBypass(() =>
      this.prisma.txn(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() },
        });
        await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
        await this.audit.record(
          { tenantId: user.tenantId, actorId: user.id, action: 'auth.changePassword', entity: 'User', entityId: user.id },
          tx,
        );
      }),
    );
    await this.limiter.reset(key);
    return withBypass(() => this.issueTokens(user.id, user.tenantId, user.role));
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

/** 已轮换的刷新令牌在宽限期外被再次使用 */
export class RefreshTokenReusedError extends UnauthorizedException {
  constructor() {
    super('Refresh token already rotated');
  }
}
