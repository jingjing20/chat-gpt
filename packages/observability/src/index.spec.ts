import {
  createTraceContext,
  metrics,
  parseTraceparent,
  redact,
  runWithTrace,
  structuredLog,
} from './index';

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

  it('输出 Prometheus counter 和 gauge', () => {
    metrics.increment('test_requests_total', { status: 'ok' });
    metrics.gauge('test_backlog', 2);
    expect(metrics.render()).toContain('test_requests_total{status="ok"} 1');
    expect(metrics.render()).toContain('test_backlog 2');
  });
});
