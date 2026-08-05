import type { ApiEnv } from '@chat/config';
import { Inject, Injectable } from '@nestjs/common';
import { API_ENV } from '../config/app-config';

interface RateWindow {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitService {
  private readonly windows = new Map<string, RateWindow>();

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  consume(key: string, now = Date.now()): number | null {
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, {
        count: 1,
        resetAt: now + this.env.AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000,
      });
      return null;
    }
    current.count += 1;
    if (current.count <= this.env.AUTH_RATE_LIMIT_MAX) return null;
    return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  }
}
