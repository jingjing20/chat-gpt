import { metrics } from '@chat/observability';
import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../auth/auth.decorators';

@Controller('metrics')
@Public()
export class MetricsController {
  @Get()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  read(): string {
    return metrics.render();
  }
}
