import {
  metrics,
  parseTraceparent,
  runWithTrace,
  createTraceContext,
  traceparent,
} from '@chat/observability';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

@Injectable()
export class ObservabilityMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    const parent = parseTraceparent(request.header('traceparent'));
    const context = createTraceContext({
      ...parent,
      requestId: request.requestId,
    });
    response.setHeader('traceparent', traceparent(context));
    runWithTrace(context, () => {
      response.once('finish', () => {
        metrics.increment('chat_http_requests_total', {
          service: 'api',
          method: request.method,
          status: String(response.statusCode),
        });
        metrics.gauge(
          'chat_http_request_duration_seconds_last',
          Number(process.hrtime.bigint() - startedAt) / 1_000_000_000,
          { service: 'api', method: request.method },
        );
      });
      next();
    });
  }
}
