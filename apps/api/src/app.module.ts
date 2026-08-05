import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health.controller';
import { RequestIdMiddleware } from './http/request-id.middleware';
import { ProtectedResourceController } from './protected-resource.controller';

@Module({
  imports: [AppConfigModule, DatabaseModule, AuthModule],
  controllers: [HealthController, ProtectedResourceController],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
