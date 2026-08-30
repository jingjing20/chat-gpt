/** 提供日志脱敏、分布式追踪、OpenTelemetry 和进程指标基础设施。 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import {
  context as otelContext,
  propagation,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

export interface TraceContext {
  traceId: string;
  spanId: string;
  requestId?: string;
  generationId?: string;
}

const traceStorage = new AsyncLocalStorage<TraceContext>();
let telemetrySdk: NodeSDK | undefined;
const sensitiveKey =
  /(?:authorization|cookie|password|secret|token|api[-_]?key|content|prompt|message)/i;
const bearer = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const cookie = /\b(?:access_token|refresh_token|session)=[^;\s]+/gi;

/** 递归移除敏感键和值中的令牌片段，确保日志默认不泄露用户秘密。 */
export function redact(value: unknown, key = ''): unknown {
  if (sensitiveKey.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    return value
      .replace(bearer, 'Bearer [REDACTED]')
      .replace(cookie, '[REDACTED]');
  }
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        redact(child, childKey),
      ]),
    );
  }
  return value;
}

export function parseTraceparent(
  value?: string,
): Pick<TraceContext, 'traceId' | 'spanId'> | undefined {
  const match = value?.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-(?:0[01])$/i);
  const traceId = match?.[1];
  const spanId = match?.[2];
  if (!traceId || !spanId || /^0+$/.test(traceId) || /^0+$/.test(spanId))
    return undefined;
  return { traceId: traceId.toLowerCase(), spanId: spanId.toLowerCase() };
}

/** 接续合法上游 traceparent；无上游时创建新的根追踪上下文。 */
export function createTraceContext(
  input: Partial<TraceContext> = {},
): TraceContext {
  return {
    traceId: input.traceId ?? randomBytes(16).toString('hex'),
    spanId: input.spanId ?? randomBytes(8).toString('hex'),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.generationId ? { generationId: input.generationId } : {}),
  };
}

export function runWithTrace<T>(context: TraceContext, callback: () => T): T {
  return traceStorage.run(context, callback);
}

export function currentTrace(): TraceContext | undefined {
  return traceStorage.getStore();
}

export function traceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-01`;
}

export function initializeOpenTelemetry(serviceName: string): void {
  if (telemetrySdk || process.env.OTEL_SDK_DISABLED === 'true') return;
  process.env.OTEL_SERVICE_NAME ??= serviceName;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  telemetrySdk = new NodeSDK({
    ...(endpoint
      ? { traceExporter: new OTLPTraceExporter({ url: endpoint }) }
      : {}),
  });
  telemetrySdk.start();
}

export async function shutdownOpenTelemetry(): Promise<void> {
  const sdk = telemetrySdk;
  telemetrySdk = undefined;
  await sdk?.shutdown();
}

export function startTelemetrySpan(
  name: string,
  attributes: Attributes = {},
  carrier?: Record<string, unknown>,
): Span {
  const parent = carrier
    ? propagation.extract(otelContext.active(), carrier)
    : otelContext.active();
  return otelContext.with(parent, () =>
    trace.getTracer('concurrent-chat').startSpan(name, { attributes }),
  );
}

export function finishTelemetrySpan(span: Span, statusCode: number): void {
  span.setAttribute('http.response.status_code', statusCode);
  span.setStatus({
    code: statusCode >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK,
  });
  span.end();
}

/** 在异步本地上下文中执行回调，并统一完成 span 状态与异常记录。 */
export async function runWithTelemetrySpan<T>(
  name: string,
  attributes: Attributes,
  callback: (
    context: Pick<TraceContext, 'traceId' | 'spanId'>,
  ) => T | Promise<T>,
): Promise<T> {
  return trace
    .getTracer('concurrent-chat')
    .startActiveSpan(name, { attributes }, async (span) => {
      const spanContext = span.spanContext();
      try {
        const result = await callback({
          traceId: spanContext.traceId,
          spanId: spanContext.spanId,
        });
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'unknown error',
        });
        throw error;
      } finally {
        span.end();
      }
    });
}

type Labels = Record<string, string>;

function labelKey(labels: Labels): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('|');
}

function prometheusLabels(labels: Labels): string {
  const entries = Object.entries(labels);
  if (!entries.length) return '';
  return `{${entries.map(([key, value]) => `${key}="${value.replace(/[\\"\n]/g, '\\$&')}"`).join(',')}}`;
}

export class MetricsRegistry {
  private readonly counters = new Map<
    string,
    Map<string, { labels: Labels; value: number }>
  >();
  private readonly gauges = new Map<
    string,
    Map<string, { labels: Labels; value: number }>
  >();
  private readonly histograms = new Map<
    string,
    Map<
      string,
      {
        labels: Labels;
        buckets: number[];
        bucketCounts: number[];
        count: number;
        sum: number;
      }
    >
  >();

  increment(name: string, labels: Labels = {}, value = 1): void {
    this.set(
      this.counters,
      name,
      labels,
      (this.get(this.counters, name, labels)?.value ?? 0) + value,
    );
  }

  gauge(name: string, value: number, labels: Labels = {}): void {
    this.set(this.gauges, name, labels, value);
  }

  observe(
    name: string,
    value: number,
    labels: Labels = {},
    buckets = [0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
  ): void {
    const values = this.histograms.get(name) ?? new Map();
    const key = labelKey(labels);
    const histogram = values.get(key) ?? {
      labels,
      buckets,
      bucketCounts: buckets.map(() => 0),
      count: 0,
      sum: 0,
    };
    histogram.count += 1;
    histogram.sum += value;
    histogram.bucketCounts = histogram.bucketCounts.map(
      (count: number, index: number) =>
        value <= histogram.buckets[index]! ? count + 1 : count,
    );
    values.set(key, histogram);
    this.histograms.set(name, values);
  }

  /** 将当前计数器、仪表和直方图快照序列化为 Prometheus exposition 格式。 */
  render(): string {
    const lines: string[] = [];
    for (const [type, collection] of [
      ['counter', this.counters],
      ['gauge', this.gauges],
    ] as const) {
      for (const [name, values] of collection) {
        lines.push(`# TYPE ${name} ${type}`);
        for (const item of values.values())
          lines.push(`${name}${prometheusLabels(item.labels)} ${item.value}`);
      }
    }
    for (const [name, values] of this.histograms) {
      lines.push(`# TYPE ${name} histogram`);
      for (const item of values.values()) {
        item.buckets.forEach((bucket, index) => {
          lines.push(
            `${name}_bucket${prometheusLabels({ ...item.labels, le: String(bucket) })} ${item.bucketCounts[index]}`,
          );
        });
        lines.push(
          `${name}_bucket${prometheusLabels({ ...item.labels, le: '+Inf' })} ${item.count}`,
        );
        lines.push(`${name}_sum${prometheusLabels(item.labels)} ${item.sum}`);
        lines.push(
          `${name}_count${prometheusLabels(item.labels)} ${item.count}`,
        );
      }
    }
    return `${lines.join('\n')}\n`;
  }

  private get(
    collection: Map<string, Map<string, { labels: Labels; value: number }>>,
    name: string,
    labels: Labels,
  ) {
    return collection.get(name)?.get(labelKey(labels));
  }

  private set(
    collection: Map<string, Map<string, { labels: Labels; value: number }>>,
    name: string,
    labels: Labels,
    value: number,
  ): void {
    const values = collection.get(name) ?? new Map();
    values.set(labelKey(labels), { labels, value });
    collection.set(name, values);
  }
}

export const metrics = new MetricsRegistry();

export function recordProcessMetrics(service: string): void {
  const memory = process.memoryUsage();
  metrics.gauge('process_resident_memory_bytes', memory.rss, { service });
  metrics.gauge('nodejs_heap_size_used_bytes', memory.heapUsed, { service });
  metrics.gauge('nodejs_external_memory_bytes', memory.external, { service });
}

/** 输出经过脱敏且附带当前追踪标识的单行 JSON 日志。 */
export function structuredLog(
  level: string,
  message: unknown,
  context?: string,
  extra?: Record<string, unknown>,
): string {
  return JSON.stringify(
    redact({
      timestamp: new Date().toISOString(),
      level,
      context,
      event: typeof message === 'string' ? message : String(message),
      ...currentTrace(),
      ...extra,
    }),
  );
}

export class JsonLogger {
  log(message: unknown, context?: string): void {
    process.stdout.write(`${structuredLog('info', message, context)}\n`);
  }
  fatal(message: unknown, context?: string): void {
    process.stderr.write(`${structuredLog('fatal', message, context)}\n`);
  }
  error(message: unknown, trace?: string, context?: string): void {
    process.stderr.write(
      `${structuredLog('error', message, context, trace ? { errorType: 'exception' } : undefined)}\n`,
    );
  }
  warn(message: unknown, context?: string): void {
    process.stderr.write(`${structuredLog('warn', message, context)}\n`);
  }
  debug(message: unknown, context?: string): void {
    process.stdout.write(`${structuredLog('debug', message, context)}\n`);
  }
  verbose(message: unknown, context?: string): void {
    process.stdout.write(`${structuredLog('trace', message, context)}\n`);
  }
}
