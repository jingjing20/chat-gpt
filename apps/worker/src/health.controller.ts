import type { HealthResponse } from '@chat/contracts';
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get('live')
  live(): HealthResponse {
    return this.response();
  }

  @Get('ready')
  ready(): HealthResponse {
    return this.response({ config: 'ok' });
  }

  private response(checks?: Record<string, 'ok'>): HealthResponse {
    return {
      status: 'ok',
      service: 'worker',
      timestamp: new Date().toISOString(),
      ...(checks ? { checks } : {}),
    };
  }
}
