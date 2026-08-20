import {
  createTraceContext,
  finishTelemetrySpan,
  metrics,
  parseTraceparent,
  recordProcessMetrics,
  redact,
  runWithTelemetrySpan,
  runWithTrace,
  startTelemetrySpan,
  initializeOpenTelemetry,
  shutdownOpenTelemetry,
  structuredLog,
} from './index';
import { createServer } from 'node:http';

describe('observability', () => {
  it('递归脱敏认证信息和用户正文', () => {
    expect(
      redact({
        password: 'p',
        content: '正文',
        nested: { authorization: 'Bearer abc' },
      }),
    ).toEqual({
      password: '[REDACTED]',
      content: '[REDACTED]',
      nested: { authorization: '[REDACTED]' },
    });
  });

  it('拒绝非法 traceparent 并将上下文写入结构化日志', () => {
    expect(parseTraceparent('00-bad-bad-01')).toBeUndefined();
    const context = createTraceContext({
      requestId: 'req-1',
      generationId: 'gen-1',
    });
    const line = runWithTrace(context, () =>
      structuredLog('info', '完成', 'Test'),
    );
    expect(JSON.parse(line)).toMatchObject({
      traceId: context.traceId,
      requestId: 'req-1',
      generationId: 'gen-1',
    });
  });

  it('输出 Prometheus counter、gauge 和 histogram', () => {
    metrics.increment('test_requests_total', { status: 'ok' });
    metrics.gauge('test_backlog', 2);
    metrics.observe(
      'test_latency_seconds',
      0.08,
      { path: 'event' },
      [0.05, 0.1],
    );
    expect(metrics.render()).toContain('test_requests_total{status="ok"} 1');
    expect(metrics.render()).toContain('test_backlog 2');
    expect(metrics.render()).toContain(
      'test_latency_seconds_bucket{path="event",le="0.1"} 1',
    );
    expect(metrics.render()).toContain(
      'test_latency_seconds_count{path="event"} 1',
    );
  });

  it('输出进程内存指标供长连接演练比较', () => {
    recordProcessMetrics('test');
    expect(metrics.render()).toContain(
      'process_resident_memory_bytes{service="test"}',
    );
  });

  it('在遥测 SDK 关闭时仍安全执行 span 生命周期和异步任务', async () => {
    const span = startTelemetrySpan('test.request', { 'test.kind': 'unit' });
    expect(() => finishTelemetrySpan(span, 204)).not.toThrow();

    await expect(
      runWithTelemetrySpan('test.worker', {}, async (context) => ({
        traceId: context.traceId,
        completed: true,
      })),
    ).resolves.toMatchObject({ completed: true });
  });

  it('将遥测任务错误原样抛给调用者', async () => {
    await expect(
      runWithTelemetrySpan('test.failed', {}, () => {
        throw new Error('预期失败');
      }),
    ).rejects.toThrow('预期失败');
  });

  it('通过 OTLP HTTP 导出真实 span', async () => {
    let exportedRequests = 0;
    const collector = createServer((request, response) => {
      if (request.url === '/v1/traces' && request.method === 'POST') {
        exportedRequests += 1;
      }
      request.resume();
      response.writeHead(200, { 'Content-Type': 'application/x-protobuf' });
      response.end();
    });
    await new Promise<void>((resolve) =>
      collector.listen(0, '127.0.0.1', resolve),
    );
    const address = collector.address();
    if (!address || typeof address === 'string') throw new Error('端口不可用');
    const previousDisabled = process.env.OTEL_SDK_DISABLED;
    const previousEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    process.env.OTEL_SDK_DISABLED = 'false';
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = `http://127.0.0.1:${address.port}/v1/traces`;
    try {
      initializeOpenTelemetry('observability-test');
      await runWithTelemetrySpan('test.export', { 'test.exported': true }, () =>
        Promise.resolve(),
      );
      await shutdownOpenTelemetry();
      expect(exportedRequests).toBeGreaterThan(0);
    } finally {
      if (previousDisabled === undefined) delete process.env.OTEL_SDK_DISABLED;
      else process.env.OTEL_SDK_DISABLED = previousDisabled;
      if (previousEndpoint === undefined)
        delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
      else process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = previousEndpoint;
      collector.close();
    }
  }, 15_000);
});
