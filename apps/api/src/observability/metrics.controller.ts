import { metrics, recordProcessMetrics } from '@chat/observability';
import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { Public } from '../auth/auth.decorators';
import { MetricsNetworkGuard } from './metrics-network.guard';

@Controller('metrics')
@Public()
@UseGuards(MetricsNetworkGuard)
export class MetricsController {
  @Get()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  read(): string {
    recordProcessMetrics('api');
    return metrics.render();
  }
}
