import {
  metrics,
  parseTraceparent,
  runWithTrace,
  createTraceContext,
  traceparent,
  startTelemetrySpan,
  finishTelemetrySpan,
} from '@chat/observability';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

@Injectable()
export class ObservabilityMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    const parent = parseTraceparent(request.header('traceparent'));
    const span = startTelemetrySpan(
      `HTTP ${request.method}`,
      {
        'http.request.method': request.method,
        'url.path': request.path,
      },
      request.headers,
    );
    const spanContext = span.spanContext();
    const context = createTraceContext({
      traceId: /^0+$/.test(spanContext.traceId)
        ? parent?.traceId
        : spanContext.traceId,
      spanId: /^0+$/.test(spanContext.spanId)
        ? parent?.spanId
        : spanContext.spanId,
      requestId: request.requestId,
    });
    response.setHeader('traceparent', traceparent(context));
    runWithTrace(context, () => {
      response.once('finish', () => {
        finishTelemetrySpan(span, response.statusCode);
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
