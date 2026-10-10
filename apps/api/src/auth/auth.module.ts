import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TenantsModule } from '../tenants/tenants.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtStrategy } from './jwt.strategy.js';
import { RateLimiter } from './rate-limiter.js';

@Module({
  imports: [
    PassportModule,
    TenantsModule,
    // 用工厂函数延迟读取环境变量，确保 ConfigModule 已加载 .env
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        signOptions: {
          expiresIn: (process.env.ACCESS_TOKEN_TTL ?? '15m') as never,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, RateLimiter],
})
export class AuthModule {}
