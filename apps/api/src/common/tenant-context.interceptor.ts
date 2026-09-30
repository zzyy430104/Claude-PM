import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Role } from '../generated/prisma/enums.js';
import { tenantContext } from '../prisma/tenant-context.js';
import type { AuthUser } from './auth.types.js';

/** 已登录请求：把租户写进数据库上下文，让行级安全成为业务代码之外的第二道隔离 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) return next.handle();
    const store = user.role === Role.PLATFORM_ADMIN ? { bypass: true } : { tenantId: user.tenantId };
    return new Observable((subscriber) => {
      const sub = tenantContext.run(store, () => next.handle().subscribe(subscriber));
      return () => sub.unsubscribe();
    });
  }
}
