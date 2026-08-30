/** 实现用户注册、登录、会话轮换、退出和安全审计等认证业务。 */

import type {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  UserResponse,
} from '@chat/contracts';
import { AuditAction, AuditOutcome, Prisma, UserStatus } from '@chat/database';
import type { ApiEnv } from '@chat/config';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { API_ENV } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { ApiException } from '../http/api-exception';
import { SecurityService } from './security.service';

export interface RequestContext {
  requestId: string;
  ipAddress: string;
  userAgent?: string;
}

export interface AuthResult extends AuthResponse {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly security: SecurityService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    this.dummyHash = argon2.hash(randomBytes(32), { type: argon2.argon2id });
  }

  /** 创建用户与首个刷新会话，并返回可写入 Cookie 的令牌组合。 */
  async register(
    input: RegisterRequest,
    context: RequestContext,
  ): Promise<AuthResult> {
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });
    const refreshToken = this.security.createOpaqueToken();
    const csrfToken = this.security.createOpaqueToken();

    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: { email: input.email, passwordHash },
        });
        await transaction.refreshSession.create({
          data: this.sessionData(user.id, refreshToken, context),
        });
        await transaction.auditLog.create({
          data: {
            userId: user.id,
            action: AuditAction.USER_REGISTERED,
            outcome: AuditOutcome.SUCCEEDED,
            requestId: context.requestId,
            ipHash: this.security.hashAuditValue(context.ipAddress),
          },
        });
        return user;
      });
      return this.authResult(result, refreshToken, csrfToken);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ApiException(
          'EMAIL_ALREADY_REGISTERED',
          '该邮箱已注册',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  /** 校验凭据后新建独立会话；失败审计只保存不可逆摘要。 */
  async login(
    input: LoginRequest,
    context: RequestContext,
  ): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
    });
    const passwordMatches = await argon2.verify(
      user?.passwordHash ?? (await this.dummyHash),
      input.password,
    );

    if (!user || !passwordMatches || user.status !== UserStatus.ACTIVE) {
      await this.prisma.auditLog.create({
        data: {
          userId: user?.id,
          action: AuditAction.LOGIN_FAILED,
          outcome: AuditOutcome.FAILED,
          requestId: context.requestId,
          subjectId: this.security.hashAuditValue(input.email),
          ipHash: this.security.hashAuditValue(context.ipAddress),
        },
      });
      throw new ApiException(
        'INVALID_CREDENTIALS',
        '邮箱或密码错误',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const refreshToken = this.security.createOpaqueToken();
    const csrfToken = this.security.createOpaqueToken();
    await this.prisma.$transaction([
      this.prisma.refreshSession.create({
        data: this.sessionData(user.id, refreshToken, context),
      }),
      this.prisma.auditLog.create({
        data: {
          userId: user.id,
          action: AuditAction.LOGIN_SUCCEEDED,
          outcome: AuditOutcome.SUCCEEDED,
          requestId: context.requestId,
          ipHash: this.security.hashAuditValue(context.ipAddress),
        },
      }),
    ]);
    return this.authResult(user, refreshToken, csrfToken);
  }

  /** 轮换一次性刷新令牌，拒绝已撤销、过期或疑似重放的会话。 */
  async refresh(
    refreshToken: string | undefined,
    context: RequestContext,
  ): Promise<AuthResult> {
    if (!refreshToken) throw this.invalidSession();
    const tokenHash = this.security.hashToken(refreshToken);
    const replacement = this.security.createOpaqueToken();
    const csrfToken = this.security.createOpaqueToken();

    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    const now = new Date();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.user.status !== UserStatus.ACTIVE
    ) {
      await this.recordRejectedSession(session?.userId, tokenHash, context);
      throw this.invalidSession();
    }

    try {
      await this.prisma.$transaction(async (transaction) => {
        const revoked = await transaction.refreshSession.updateMany({
          where: { id: session.id, revokedAt: null, expiresAt: { gt: now } },
          data: { revokedAt: now },
        });
        if (revoked.count !== 1) throw this.invalidSession();
        const next = await transaction.refreshSession.create({
          data: {
            ...this.sessionData(session.userId, replacement, context),
            rotatedFromId: session.id,
          },
        });
        await transaction.auditLog.create({
          data: {
            userId: session.userId,
            action: AuditAction.SESSION_REFRESHED,
            outcome: AuditOutcome.SUCCEEDED,
            requestId: context.requestId,
            subjectId: next.id,
            ipHash: this.security.hashAuditValue(context.ipAddress),
          },
        });
      });
    } catch (error) {
      if (error instanceof ApiException) throw error;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw this.invalidSession();
      }
      throw error;
    }

    return this.authResult(session.user, replacement, csrfToken);
  }

  /** 仅撤销当前刷新会话，保证其他设备上的会话不受影响。 */
  async logout(
    userId: string,
    refreshToken: string | undefined,
    context: RequestContext,
  ): Promise<void> {
    if (!refreshToken) return;
    const tokenHash = this.security.hashToken(refreshToken);
    const now = new Date();
    const session = await this.prisma.refreshSession.findFirst({
      where: { tokenHash, userId },
      select: { id: true },
    });
    if (!session) return;

    await this.prisma.$transaction([
      this.prisma.refreshSession.updateMany({
        where: { id: session.id, userId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.auditLog.create({
        data: {
          userId,
          action: AuditAction.SESSION_REVOKED,
          outcome: AuditOutcome.SUCCEEDED,
          requestId: context.requestId,
          subjectId: session.id,
          ipHash: this.security.hashAuditValue(context.ipAddress),
        },
      }),
    ]);
  }

  async me(userId: string): Promise<UserResponse> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: UserStatus.ACTIVE },
    });
    if (!user) throw this.invalidSession();
    return this.toUserResponse(user);
  }

  private async authResult(
    user: { id: string; email: string; status: UserStatus; createdAt: Date },
    refreshToken: string,
    csrfToken: string,
  ): Promise<AuthResult> {
    return {
      user: this.toUserResponse(user),
      csrfToken,
      accessToken: await this.security.createAccessToken(user.id),
      refreshToken,
    };
  }

  private toUserResponse(user: {
    id: string;
    email: string;
    status: UserStatus;
    createdAt: Date;
  }): UserResponse {
    return {
      id: user.id,
      email: user.email,
      status: 'ACTIVE',
      createdAt: user.createdAt.toISOString(),
    };
  }

  private sessionData(userId: string, token: string, context: RequestContext) {
    return {
      userId,
      tokenHash: this.security.hashToken(token),
      userAgentHash: context.userAgent
        ? this.security.hashAuditValue(context.userAgent)
        : null,
      expiresAt: new Date(
        Date.now() + this.env.REFRESH_TOKEN_TTL_SECONDS * 1000,
      ),
    };
  }

  /** 记录不含原始令牌、邮箱或消息内容的会话拒绝审计事件。 */
  private async recordRejectedSession(
    userId: string | undefined,
    tokenHash: string,
    context: RequestContext,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: AuditAction.SESSION_REJECTED,
        outcome: AuditOutcome.FAILED,
        requestId: context.requestId,
        subjectId: tokenHash,
        ipHash: this.security.hashAuditValue(context.ipAddress),
      },
    });
  }

  private invalidSession(): ApiException {
    return new ApiException(
      'UNAUTHENTICATED',
      '登录会话无效或已过期',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
