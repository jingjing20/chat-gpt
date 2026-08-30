/** 封装 JWT、不可逆令牌摘要、审计脱敏摘要和安全比较操作。 */

import type { ApiEnv } from '@chat/config';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { API_ENV } from '../config/app-config';

interface AccessPayload {
  sub: string;
  type: 'access';
}

@Injectable()
export class SecurityService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  createAccessToken(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, type: 'access' } satisfies AccessPayload,
      {
        secret: this.env.ACCESS_TOKEN_SECRET,
        expiresIn: this.env.ACCESS_TOKEN_TTL_SECONDS,
      },
    );
  }

  async verifyAccessToken(token: string): Promise<AccessPayload> {
    const payload = await this.jwt.verifyAsync<AccessPayload>(token, {
      secret: this.env.ACCESS_TOKEN_SECRET,
    });
    if (payload.type !== 'access' || typeof payload.sub !== 'string') {
      throw new Error('访问令牌类型不正确');
    }
    return payload;
  }

  createOpaqueToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  hashAuditValue(value: string): string {
    return createHmac('sha256', this.env.ACCESS_TOKEN_SECRET)
      .update(value)
      .digest('hex');
  }

  tokensMatch(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    );
  }
}
