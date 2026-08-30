/** 提供注册、登录、令牌刷新、退出、CSRF 初始化和当前用户查询接口。 */

import {
  loginRequestSchema,
  registerRequestSchema,
  type AuthResponse,
  type CsrfResponse,
  type LoginRequest,
  type RegisterRequest,
  type UserResponse,
} from '@chat/contracts';
import type { ApiEnv } from '@chat/config';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { API_ENV } from '../config/app-config';
import { ZodBodyPipe } from '../http/zod-body.pipe';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from './auth.constants';
import { AuthRateLimit, Public, SkipCsrf } from './auth.decorators';
import {
  AuthService,
  type AuthResult,
  type RequestContext,
} from './auth.service';
import { SecurityService } from './security.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly security: SecurityService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Get('csrf')
  @Public()
  @SkipCsrf()
  csrf(@Res({ passthrough: true }) response: Response): CsrfResponse {
    const csrfToken = this.security.createOpaqueToken();
    this.setCsrfCookie(response, csrfToken);
    return { csrfToken };
  }

  @Post('register')
  @Public()
  @AuthRateLimit()
  async register(
    @Body(new ZodBodyPipe(registerRequestSchema)) input: RegisterRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    return this.completeAuth(
      response,
      await this.auth.register(input, this.context(request)),
    );
  }

  @Post('login')
  @Public()
  @AuthRateLimit()
  @HttpCode(200)
  async login(
    @Body(new ZodBodyPipe(loginRequestSchema)) input: LoginRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    return this.completeAuth(
      response,
      await this.auth.login(input, this.context(request)),
    );
  }

  @Post('refresh')
  @Public()
  @AuthRateLimit()
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    return this.completeAuth(
      response,
      await this.auth.refresh(
        request.cookies?.[REFRESH_COOKIE] as string | undefined,
        this.context(request),
      ),
    );
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(
      request.auth!.userId,
      request.cookies?.[REFRESH_COOKIE] as string | undefined,
      this.context(request),
    );
    this.clearAuthCookies(response);
  }

  @Get('me')
  me(@Req() request: Request): Promise<UserResponse> {
    return this.auth.me(request.auth!.userId);
  }

  private completeAuth(response: Response, result: AuthResult): AuthResponse {
    const common = {
      httpOnly: true,
      secure: this.env.AUTH_COOKIE_SECURE,
      sameSite: 'lax' as const,
      path: '/api/v1/auth',
    };
    response.cookie(ACCESS_COOKIE, result.accessToken, {
      ...common,
      path: '/api/v1',
      maxAge: this.env.ACCESS_TOKEN_TTL_SECONDS * 1000,
    });
    response.cookie(REFRESH_COOKIE, result.refreshToken, {
      ...common,
      maxAge: this.env.REFRESH_TOKEN_TTL_SECONDS * 1000,
    });
    this.setCsrfCookie(response, result.csrfToken);
    return { user: result.user, csrfToken: result.csrfToken };
  }

  private setCsrfCookie(response: Response, token: string): void {
    response.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      secure: this.env.AUTH_COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      maxAge: this.env.REFRESH_TOKEN_TTL_SECONDS * 1000,
    });
  }

  private clearAuthCookies(response: Response): void {
    response.clearCookie(ACCESS_COOKIE, { path: '/api/v1' });
    response.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    response.clearCookie(CSRF_COOKIE, { path: '/' });
  }

  private context(request: Request): RequestContext {
    return {
      requestId: request.requestId ?? 'unknown',
      ipAddress: request.ip || request.socket.remoteAddress || 'unknown',
      userAgent: request.header('user-agent'),
    };
  }
}
