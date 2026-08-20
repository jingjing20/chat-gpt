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

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    AuthModule,
    ConversationsModule,
    GenerationsModule,
    OutboxModule,
    EventsModule,
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
