import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiException } from '../http/api-exception';
import { ACCESS_COOKIE, IS_PUBLIC_KEY } from './auth.constants';
import { SecurityService } from './security.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly security: SecurityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = request.cookies?.[ACCESS_COOKIE] as string | undefined;
    if (!token) throw this.unauthenticated();

    try {
      const payload = await this.security.verifyAccessToken(token);
      request.auth = { userId: payload.sub };
      return true;
    } catch {
      throw this.unauthenticated();
    }
  }

  private unauthenticated(): ApiException {
    return new ApiException(
      'UNAUTHENTICATED',
      '登录状态无效或已过期',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
