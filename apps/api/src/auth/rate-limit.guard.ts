/** 按客户端 IP 对认证端点执行固定窗口请求限流。 */

import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ApiException } from '../http/api-exception';
import { AUTH_RATE_LIMIT_KEY } from './auth.constants';
import { RateLimitService } from './rate-limit.service';
import { SecurityService } from './security.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
    private readonly security: SecurityService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const enabled = this.reflector.getAllAndOverride<boolean>(
      AUTH_RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!enabled) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const address = request.ip || request.socket.remoteAddress || 'unknown';
    const retryAfter = this.limiter.consume(
      this.security.hashAuditValue(address),
    );
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
}
