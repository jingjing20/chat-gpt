import { metrics, recordProcessMetrics } from '@chat/observability';
import { Controller, Get, Header } from '@nestjs/common';

@Controller('metrics')
export class MetricsController {
  @Get()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  read(): string {
    recordProcessMetrics('worker');
    return metrics.render();
  }
}
