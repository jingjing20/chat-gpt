/** 组装认证控制器、令牌安全服务及认证相关全局守卫。 */

import { redisConnectionOptions, type ApiEnv } from '@chat/config';
import { metrics } from '@chat/observability';
import { Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { API_ENV } from '../config/app-config';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { CsrfGuard } from './csrf.guard';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitService } from './rate-limit.service';
import { SecurityService } from './security.service';
import Redis from 'ioredis';
import { AUTH_CONTROL_REDIS } from './auth.constants';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [API_ENV],
      useFactory: (env: ApiEnv) => ({ secret: env.ACCESS_TOKEN_SECRET }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SecurityService,
    {
      provide: AUTH_CONTROL_REDIS,
      inject: [API_ENV],
      useFactory: (environment: ApiEnv) => {
        const redis = new Redis({
          ...redisConnectionOptions(environment.CONTROL_REDIS_URL),
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        });
        redis.on('error', () => {
          metrics.increment('chat_redis_client_errors_total', {
            service: 'api',
            component: 'auth_rate_limit',
          });
          Logger.error('认证限流 Redis 连接异常', AuthModule.name);
        });
        return redis;
      },
    },
    RateLimitService,
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [SecurityService],
})
export class AuthModule {}
