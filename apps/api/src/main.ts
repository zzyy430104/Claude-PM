import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // 位于 nginx / 负载均衡之后：按 X-Forwarded-For 取真实客户端 IP（限流依赖它）
  if (process.env.TRUST_PROXY !== 'false') app.set('trust proxy', 1);
  app.use(helmet());
  app.useBodyParser('json', { limit: '1mb' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
/**
 * 多进程：Node 单个进程只用一个 CPU 核。WORKERS=auto 按核数开（最多 8 个），WORKERS=1 为单进程（开发、测试）。
 * 各进程共用同一个端口，由操作系统分发请求；进程意外退出时自动补一个。
 * 首次启动创建平台管理员只在第一个进程里做（PM_BOOTSTRAP），避免重复创建。
 */
const want = process.env.WORKERS ?? '1';
const workers = want === 'auto' ? Math.min(availableParallelism(), 8) : Math.max(1, Number(want) || 1);
if (workers > 1 && cluster.isPrimary) {
  for (let i = 0; i < workers; i++) cluster.fork({ PM_BOOTSTRAP: i === 0 ? '1' : '0' });
  cluster.on('exit', (w, code, signal) => {
    if (signal === 'SIGTERM' || signal === 'SIGINT') return;
    console.error(`worker ${w.process.pid} exited (${signal ?? code}), starting a new one`);
    cluster.fork({ PM_BOOTSTRAP: '0' });
  });
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      for (const w of Object.values(cluster.workers ?? {})) w?.process.kill(sig);
      setTimeout(() => process.exit(0), 10_000).unref();
      let alive = Object.keys(cluster.workers ?? {}).length;
      cluster.on('exit', () => { if (--alive <= 0) process.exit(0); });
    });
  }
} else {
  await bootstrap();
}
