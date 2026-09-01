/** 验证分布式认证限流对 Redis 结果的转换与多维 key 隔离。 */

import type { ApiEnv } from '@chat/config';
import type Redis from 'ioredis';
import { RateLimitService } from './rate-limit.service';

describe('RateLimitService', () => {
  const environment = {
    AUTH_RATE_LIMIT_MAX: 2,
    AUTH_RATE_LIMIT_WINDOW_SECONDS: 10,
    EVENT_KEY_PREFIX: 'chat:test:evt',
  } as ApiEnv;

  it('任一维度超限时返回向上取整的等待秒数', async () => {
    const evalMock = jest.fn().mockResolvedValue(9_001);
    const service = new RateLimitService(
      { eval: evalMock } as unknown as Redis,
      environment,
    );

    await expect(service.consume(['ip:hash', 'account:hash'])).resolves.toBe(
      10,
    );
    expect(evalMock).toHaveBeenCalledWith(
      expect.any(String),
      2,
      'chat:test:evt:auth-rate:ip:hash',
      'chat:test:evt:auth-rate:account:hash',
      2,
      10_000,
    );
  });

  it('未超限时返回 null', async () => {
    const service = new RateLimitService(
      { eval: jest.fn().mockResolvedValue(0) } as unknown as Redis,
      environment,
    );
    await expect(service.consume(['ip:hash'])).resolves.toBeNull();
  });
});
