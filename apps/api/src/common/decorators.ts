import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { Role } from '../generated/prisma/enums.js';
import type { AuthUser } from './auth.types.js';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** 跳过 JWT 校验（登录、注册、健康检查） */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** 限定可访问的角色；不加则任何已登录用户可访问 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);
