/** 提供 API 存活状态及 PostgreSQL 就绪状态探针。 */

import type { HealthResponse } from '@chat/contracts';
import { Controller, Get, HttpStatus } from '@nestjs/common';
import { Public } from './auth/auth.decorators';
import { PrismaService } from './database/prisma.service';
import { ApiException } from './http/api-exception';

@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  live(): HealthResponse {
    return this.response();
  }

  @Get('ready')
  async ready(): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return this.response({ config: 'ok', database: 'ok' });
    } catch {
      throw new ApiException(
        'DEPENDENCY_UNAVAILABLE',
        '数据库尚未就绪',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private response(checks?: Record<string, 'ok'>): HealthResponse {
    return {
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
      ...(checks ? { checks } : {}),
    };
  }
}
