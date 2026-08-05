import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiException } from '../http/api-exception';
import { CSRF_COOKIE, SKIP_CSRF_KEY } from './auth.constants';
import { SecurityService } from './security.service';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly security: SecurityService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ||
      this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const cookie = request.cookies?.[CSRF_COOKIE] as string | undefined;
    const header = request.header('x-csrf-token');
    if (!cookie || !header || !this.security.tokensMatch(cookie, header)) {
      throw new ApiException(
        'CSRF_VALIDATION_FAILED',
        'CSRF 校验失败',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
