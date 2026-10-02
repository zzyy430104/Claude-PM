import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { lastValueFrom, Observable, toArray } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { Role } from '../generated/prisma/enums.js';
import { tenantContext } from '../prisma/tenant-context.js';
import type { AuthUser } from './auth.types.js';

/** 已登录请求：把租户写进数据库上下文，让行级安全成为业务代码之外的第二道隔离 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    if (!user) return next.handle();
    const store = user.role === Role.PLATFORM_ADMIN ? { bypass: true } : { tenantId: user.tenantId };
    // GET 请求整个放进一个事务（PrismaService.readScope），查询多的页面（工作台、项目总览）明显更快
    if (req.method === 'GET') {
      return new Observable((subscriber) => {
        tenantContext.run(store, () => this.prisma.readScope(() => lastValueFrom(next.handle().pipe(toArray()))))
          .then((values) => { for (const v of values) subscriber.next(v); subscriber.complete(); })
          .catch((e) => subscriber.error(e));
      });
    }
    return new Observable((subscriber) => {
      const sub = tenantContext.run(store, () => next.handle().subscribe(subscriber));
      return () => sub.unsubscribe();
    });
  }
}
