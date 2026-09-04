/** 组装 API 根模块，并为 HTTP 请求挂载请求标识与可观测性中间件。 */

import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { ConversationsModule } from './conversations/conversations.module';
import { HealthController } from './health.controller';
import { RequestIdMiddleware } from './http/request-id.middleware';
import { ProtectedResourceController } from './protected-resource.controller';
import { GenerationsModule } from './generations/generations.module';
import { OutboxModule } from './outbox/outbox.module';
import { EventsModule } from './events/events.module';
import { MetricsController } from './observability/metrics.controller';
import { ObservabilityMiddleware } from './observability/observability.middleware';
import { MetricsNetworkGuard } from './observability/metrics-network.guard';
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    AuthModule,
    ConversationsModule,
    GenerationsModule,
    OutboxModule,
    EventsModule,
    TasksModule,
  ],
  controllers: [
    HealthController,
    ProtectedResourceController,
    MetricsController,
  ],
  providers: [MetricsNetworkGuard],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware, ObservabilityMiddleware)
      .forRoutes('{*path}');
  }
}
