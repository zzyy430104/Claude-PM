import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthUser } from '../common/auth.types.js';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { withBypass } from '../prisma/tenant-context.js';

export interface JwtPayload {
  sub: string;
  tid: string | null;
  role: Role;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET as string,
    });
  }

  /** 每次请求回库校验，用户或租户被停用后立即失效，角色以数据库为准 */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await withBypass(() =>
      this.prisma.user.findUnique({ where: { id: payload.sub }, include: { tenant: true } }),
    );
    if (!user || !user.active || (user.tenant && !user.tenant.active)) {
      throw new UnauthorizedException();
    }
    return {
      id: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
      name: user.name,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
