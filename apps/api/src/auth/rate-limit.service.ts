/** 使用控制 Redis 原子执行多维固定窗口认证限流。 */

import type { ApiEnv } from '@chat/config';
import { metrics } from '@chat/observability';
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import type Redis from 'ioredis';
import { API_ENV } from '../config/app-config';
import { AUTH_CONTROL_REDIS } from './auth.constants';

@Injectable()
export class RateLimitService implements OnApplicationShutdown {
  constructor(
    @Inject(AUTH_CONTROL_REDIS) private readonly redis: Redis,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** 任一维度超限即返回最长重试秒数；Redis 故障由调用方 fail-closed。 */
  async consume(keys: string[]): Promise<number | null> {
    if (keys.length === 0) return null;
    const redisKeys = keys.map(
      (key) => `${this.env.EVENT_KEY_PREFIX}:auth-rate:${key}`,
    );
    const retryMs = Number(
      await this.redis.eval(
        `
        local retry_ms = 0
        for i = 1, #KEYS do
          local count = redis.call('INCR', KEYS[i])
          if count == 1 then redis.call('PEXPIRE', KEYS[i], ARGV[2]) end
          if count > tonumber(ARGV[1]) then
            local ttl = redis.call('PTTL', KEYS[i])
            if ttl > retry_ms then retry_ms = ttl end
          end
        end
        return retry_ms
        `,
        redisKeys.length,
        ...redisKeys,
        this.env.AUTH_RATE_LIMIT_MAX,
        this.env.AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000,
      ),
    );
    if (retryMs <= 0) return null;
    metrics.increment('chat_auth_rate_limit_rejections_total');
    return Math.max(1, Math.ceil(retryMs / 1000));
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'ready') await this.redis.quit();
    else this.redis.disconnect();
  }
}
