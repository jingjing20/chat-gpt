/** 验证访问令牌、随机令牌、摘要和常量时间比较等安全能力。 */

import type { ApiEnv } from '@chat/config';
import { JwtService } from '@nestjs/jwt';
import { SecurityService } from './security.service';

describe('SecurityService', () => {
  const environment: ApiEnv = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    QUEUE_REDIS_URL: 'redis://localhost:6379',
    CONTROL_REDIS_URL: 'redis://localhost:6379',
    OTEL_SDK_DISABLED: true,
    API_PORT: 3001,
    ACCESS_TOKEN_SECRET: 'test-only-access-token-secret-at-least-32-chars',
    ACCESS_TOKEN_TTL_SECONDS: 900,
    REFRESH_TOKEN_TTL_SECONDS: 2_592_000,
    AUTH_COOKIE_SECURE: false,
    AUTH_RATE_LIMIT_MAX: 10,
    AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
    LLM_PROVIDER: 'deepseek',
    LLM_DEFAULT_MODEL: 'configured-test-model',
    OUTBOX_DISPATCH_INTERVAL_MS: 500,
    OUTBOX_RELAY_ENABLED: true,
    OUTBOX_DISPATCH_BATCH_SIZE: 20,
    OUTBOX_LOCK_TIMEOUT_MS: 30_000,
    OUTBOX_MAX_ATTEMPTS: 12,
    DATA_RETENTION_CLEANUP_INTERVAL_MS: 21_600_000,
    OUTBOX_RETENTION_DAYS: 7,
    AUDIT_RETENTION_DAYS: 180,
    SECURITY_AUDIT_RETENTION_DAYS: 730,
    USAGE_RETENTION_DAYS: 730,
    GENERATION_QUEUE_COMPLETED_RETENTION_COUNT: 1_000,
    GENERATION_QUEUE_FAILED_RETENTION_COUNT: 1_000,
    GENERATION_QUEUE_PREFIX: 'chat:test:queue',
    EVENT_KEY_PREFIX: 'chat:test:evt',
    EVENT_HEARTBEAT_MS: 20_000,
    SSE_MAX_CONNECTIONS_PER_USER: 3,
    SSE_MAX_BUFFER_BYTES: 262_144,
    SSE_DRAIN_TIMEOUT_MS: 5_000,
    EVENT_RETENTION_MS: 86_400_000,
    USER_GENERATION_CONCURRENCY_LIMIT: 2,
  };
  const service = new SecurityService(new JwtService(), environment);

  it('签发并验证访问令牌', async () => {
    const token = await service.createAccessToken('user-id');
    await expect(service.verifyAccessToken(token)).resolves.toMatchObject({
      sub: 'user-id',
      type: 'access',
    });
  });

  it('生成随机刷新令牌并只产生固定长度摘要', () => {
    const first = service.createOpaqueToken();
    const second = service.createOpaqueToken();
    expect(first).not.toBe(second);
    expect(service.hashToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(service.hashToken(first)).not.toContain(first);
  });

  it('以恒定时间比较 CSRF 令牌', () => {
    expect(service.tokensMatch('same-token', 'same-token')).toBe(true);
    expect(service.tokensMatch('same-token', 'other-token')).toBe(false);
  });
});
