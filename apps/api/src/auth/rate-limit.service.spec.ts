/** 验证固定窗口限流的计数、过期重置和拒绝等待时间。 */

import type { ApiEnv } from '@chat/config';
import { RateLimitService } from './rate-limit.service';

describe('RateLimitService', () => {
  const environment = {
    AUTH_RATE_LIMIT_MAX: 2,
    AUTH_RATE_LIMIT_WINDOW_SECONDS: 10,
  } as ApiEnv;

  it('在窗口内拒绝超额请求，并在新窗口恢复', () => {
    const service = new RateLimitService(environment);
    expect(service.consume('ip', 1_000)).toBeNull();
    expect(service.consume('ip', 1_001)).toBeNull();
    expect(service.consume('ip', 1_002)).toBe(10);
    expect(service.consume('ip', 11_000)).toBeNull();
  });
});
