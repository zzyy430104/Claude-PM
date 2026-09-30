import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators.js';
import { Role } from '../generated/prisma/enums.js';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}

const PASSWORD_CHANGE_ALLOWED = new Set(['/me', '/auth/change-password', '/auth/logout', '/notifications/count']);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    // 管理员设置或重置的密码必须先改掉，之前只放行查看本人、改密和退出
    if (req.user?.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(req.route?.path)) {
      throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'Change your password before continuing' });
    }
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles || roles.length === 0) return true;
    const user = req.user;
    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
