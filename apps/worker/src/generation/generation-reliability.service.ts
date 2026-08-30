/** 通过 Redis 实现用户并发许可和 generation 分布式租约。 */

import { redisConnectionOptions, type WorkerEnv } from '@chat/config';
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { metrics } from '@chat/observability';
import { WORKER_ENV } from '../config/worker-config';

export interface GenerationPermit {
  token: string;
  keys: string[];
}

@Injectable()
export class GenerationReliabilityService implements OnApplicationShutdown {
  private readonly redis: Redis;

  constructor(@Inject(WORKER_ENV) private readonly environment: WorkerEnv) {
    this.redis = new Redis({
      ...redisConnectionOptions(environment.REDIS_URL),
      maxRetriesPerRequest: 1,
    });
    this.redis.on('error', () => {
      metrics.increment('chat_redis_client_errors_total', {
        service: 'worker',
        component: 'generation_reliability',
      });
    });
  }

  /** 原子获取 generation 租约和用户并发槽，阻止重复消费与超额并发。 */
  async acquire(input: {
    generationId: string;
    userId: string;
    provider: string;
    token: string;
  }): Promise<GenerationPermit | null> {
    const keys = [
      `${this.environment.EVENT_KEY_PREFIX}:semaphore:global`,
      `${this.environment.EVENT_KEY_PREFIX}:semaphore:provider:${input.provider}`,
      `${this.environment.EVENT_KEY_PREFIX}:semaphore:user:${input.userId}`,
    ];
    const limits = [
      this.environment.GENERATION_GLOBAL_CONCURRENCY,
      this.environment.GENERATION_PROVIDER_CONCURRENCY,
      this.environment.GENERATION_USER_CONCURRENCY,
    ];
    const deadline = Date.now() + this.environment.GENERATION_SEMAPHORE_WAIT_MS;
    let firstAttempt = true;
    while (firstAttempt || Date.now() <= deadline) {
      firstAttempt = false;
      let acquired = 0;
      try {
        acquired = Number(
          await this.redis.eval(
            `
          local now = tonumber(ARGV[1])
          local expires = tonumber(ARGV[2])
          local token = ARGV[3]
          for i = 1, #KEYS do
            redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now)
            if redis.call('ZCARD', KEYS[i]) >= tonumber(ARGV[i + 3]) then
              return 0
            end
          end
          for i = 1, #KEYS do
            redis.call('ZADD', KEYS[i], expires, token)
            redis.call('PEXPIRE', KEYS[i], expires - now + 1000)
          end
          return 1
          `,
            keys.length,
            ...keys,
            Date.now(),
            Date.now() + this.environment.GENERATION_SEMAPHORE_TTL_MS,
            input.token,
            ...limits,
          ),
        );
      } catch {
        if (Date.now() >= deadline)
          throw new Error('REDIS_TEMPORARILY_UNAVAILABLE');
      }
      if (acquired === 1) return { token: input.token, keys };
      if (Date.now() >= deadline) return null;
      await new Promise((resolve) =>
        setTimeout(resolve, 40 + Math.floor(Math.random() * 40)),
      );
    }
    return null;
  }

  /** 仅由当前租约令牌持有者续期，避免旧 Worker 延长新任务的租约。 */
  async renew(permit: GenerationPermit): Promise<boolean> {
    const renewed = Number(
      await this.redis.eval(
        `
        local renewed = 0
        for i = 1, #KEYS do
          if redis.call('ZSCORE', KEYS[i], ARGV[1]) then
            redis.call('ZADD', KEYS[i], ARGV[2], ARGV[1])
            redis.call('PEXPIRE', KEYS[i], tonumber(ARGV[3]))
            renewed = renewed + 1
          end
        end
        return renewed
        `,
        permit.keys.length,
        ...permit.keys,
        permit.token,
        Date.now() + this.environment.GENERATION_SEMAPHORE_TTL_MS,
        this.environment.GENERATION_SEMAPHORE_TTL_MS + 1000,
      ),
    );
    return renewed === permit.keys.length;
  }

  /** 仅释放与令牌匹配的租约及其用户并发槽。 */
  async release(permit: GenerationPermit): Promise<void> {
    await this.redis.eval(
      `for i = 1, #KEYS do redis.call('ZREM', KEYS[i], ARGV[1]) end return 1`,
      permit.keys.length,
      ...permit.keys,
      permit.token,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'end') return;
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
