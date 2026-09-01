/** 按 IP、账号和刷新会话对认证端点执行分布式固定窗口限流。 */

import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ApiException } from '../http/api-exception';
import { AUTH_RATE_LIMIT_KEY, REFRESH_COOKIE } from './auth.constants';
import { RateLimitService } from './rate-limit.service';
import { SecurityService } from './security.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
    private readonly security: SecurityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const enabled = this.reflector.getAllAndOverride<boolean>(
      AUTH_RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!enabled) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const address = request.ip || request.socket.remoteAddress || 'unknown';
    const keys = [`ip:${this.security.hashAuditValue(address)}`];
    const email = this.requestEmail(request);
    if (email) keys.push(`account:${this.security.hashAuditValue(email)}`);
    const refreshToken = request.cookies?.[REFRESH_COOKIE] as
      string | undefined;
    if (refreshToken) {
      keys.push(`session:${this.security.hashToken(refreshToken)}`);
    }
    let retryAfter: number | null;
    try {
      retryAfter = await this.limiter.consume(keys);
    } catch {
      throw new ApiException(
        'AUTH_RATE_LIMIT_UNAVAILABLE',
        '认证安全服务暂时不可用，请稍后重试',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (retryAfter !== null) {
      response.setHeader('retry-after', retryAfter.toString());
      throw new ApiException(
        'AUTH_RATE_LIMITED',
        '认证请求过于频繁，请稍后重试',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private requestEmail(request: Request): string | undefined {
    const body = request.body as { email?: unknown } | undefined;
    return typeof body?.email === 'string'
      ? body.email.trim().toLowerCase()
      : undefined;
  }
}
