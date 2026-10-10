import { EngagementModule } from './engagement/engagement.module.js';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditModule } from './audit/audit.module.js';
import { CostModule } from './cost/cost.module.js';
import { QualityModule } from './quality/quality.module.js';
import { TeamModule } from './team/team.module.js';
import { ConfigurationModule } from './configuration/config.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { KnowledgeModule } from './knowledge/knowledge.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { EvidenceModule } from './evidence/evidence.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BootstrapService } from './bootstrap.service.js';
import { JwtAuthGuard, RolesGuard } from './common/guards.js';
import { TenantContextInterceptor } from './common/tenant-context.interceptor.js';
import { GovernanceModule } from './governance/governance.module.js';
import { HealthController } from './health/health.controller.js';
import { ProjectsModule } from './projects/projects.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TenantsModule } from './tenants/tenants.module.js';
import { UsersModule } from './users/users.module.js';
import { InitiationsModule } from './initiations/initiations.module.js';
import { PerformanceModule } from './performance/performance.module.js';
import { DeliveryModule } from './delivery/delivery.module.js';
import { CommModule } from './comm/comm.module.js';
import { AiModule } from './ai/ai.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    TenantsModule,
    AuthModule,
    UsersModule,
    InitiationsModule,
    PerformanceModule,
    DeliveryModule,
    CommModule,
    AiModule,
    ProjectsModule,
    GovernanceModule,
    CostModule,
    QualityModule,
    TeamModule,
    DocumentsModule,
    KnowledgeModule,
    ConfigurationModule,
    NotificationsModule,
    DashboardModule,
    EvidenceModule,
    EngagementModule,
  ],
  controllers: [HealthController],
  providers: [
    BootstrapService,
    // 默认所有接口都需要登录，公开接口显式加 @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
