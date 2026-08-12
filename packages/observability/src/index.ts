import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

export interface TraceContext {
  traceId: string;
  spanId: string;
  requestId?: string;
  generationId?: string;
}

const traceStorage = new AsyncLocalStorage<TraceContext>();
const sensitiveKey =
  /(?:authorization|cookie|password|secret|token|api[-_]?key|content|prompt|message)/i;
const bearer = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const cookie = /\b(?:access_token|refresh_token|session)=[^;\s]+/gi;

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
