import type { ApiEnv } from '@chat/config';
import { JwtService } from '@nestjs/jwt';
import { SecurityService } from './security.service';

describe('SecurityService', () => {
  const environment: ApiEnv = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    API_PORT: 3001,
    ACCESS_TOKEN_SECRET: 'test-only-access-token-secret-at-least-32-chars',
    ACCESS_TOKEN_TTL_SECONDS: 900,
    REFRESH_TOKEN_TTL_SECONDS: 2_592_000,
    AUTH_COOKIE_SECURE: false,
    AUTH_RATE_LIMIT_MAX: 10,
    AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
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
