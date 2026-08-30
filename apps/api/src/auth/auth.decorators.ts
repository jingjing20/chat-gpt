/** 提供声明公开路由、跳过 CSRF 和启用认证限流的装饰器。 */

import { SetMetadata } from '@nestjs/common';
import {
  AUTH_RATE_LIMIT_KEY,
  IS_PUBLIC_KEY,
  SKIP_CSRF_KEY,
} from './auth.constants';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);
export const AuthRateLimit = () => SetMetadata(AUTH_RATE_LIMIT_KEY, true);
