/** 验证 OpenAI 兼容流响应解析、错误映射、超时和中止处理。 */

import { OpenAiCompatibleAdapter } from './openai-compatible-adapter';
import { ProviderError, mapHttpError } from './provider-error';
import { parseDataOnlySse } from './sse-parser';

const encoder = new TextEncoder();

describe('OpenAiCompatibleAdapter', () => {
  it('归一化跨 chunk 的 reasoning、正文、usage 和 finish', async () => {
    const sse = [
      ': keep-alive\n\n',
      'data: {"id":"req_1","choices":[{"delta":{"reasoning_content":"思"},"finish_reason":null}]}\n\n',
      'data: {"id":"req_1","choices":[{"delta":{"content":"答"},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3,"completion_tokens_details":{"reasoning_tokens":1},"prompt_cache_hit_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    let capturedInit: RequestInit | undefined;
    const fetchMock = jest.fn(
      (_url: string | URL | Request, init?: RequestInit) => {
        capturedInit = init;
        return Promise.resolve(new Response(chunked(sse, [5, 13, 71])));
      },
    );
    const adapter = new OpenAiCompatibleAdapter({
      baseUrl: 'https://example.test/v1/',
      apiKey: 'secret',
      timeoutMs: 1000,
      fetch: fetchMock,
    });
    const events = await collect(
      adapter.streamChat(
        {
          model: 'deepseek',
          messages: [{ role: 'user', content: '你好' }],
          reasoning: { enabled: true, effort: 'high' },
        },
        new AbortController().signal,
      ),
    );
    expect(events).toEqual([
      { type: 'reasoning_delta', delta: '思' },
      { type: 'content_delta', delta: '答' },
      { type: 'finish', finishReason: 'stop', providerRequestId: 'req_1' },
      {
        type: 'usage',
        usage: {
          promptTokens: 2,
          completionTokens: 1,
          totalTokens: 3,
          reasoningTokens: 1,
          cacheHitTokens: 2,
          cacheMissTokens: undefined,
        },
      },
    ]);
    expect(capturedInit).toBeDefined();
    const requestBody = capturedInit?.body;
    if (typeof requestBody !== 'string')
      throw new Error('请求体必须是 JSON 字符串');
    const body = JSON.parse(requestBody) as Record<string, unknown>;
    expect(body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    });
    expect(new Headers(capturedInit?.headers).get('authorization')).toContain(
      'secret',
    );
  });

  it('忽略注释和空行，不把 DONE 当 JSON', async () => {
    const values = await collect(
      parseDataOnlySse(chunked(': ping\n\n\n\ndata: [DONE]\n\n', [2, 3])),
    );
    expect(values).toEqual(['[DONE]']);
  });

  it('将损坏的 JSON 映射为安全错误', async () => {
    const adapter = new OpenAiCompatibleAdapter({
      baseUrl: 'https://example.test',
      apiKey: 'secret',
      timeoutMs: 1000,
      fetch: jest
        .fn()
        .mockResolvedValue(new Response(chunked('data: {bad}\n\n'))),
    });
    await expect(
      collect(
        adapter.streamChat(
          { model: 'x', messages: [] },
          new AbortController().signal,
        ),
      ),
    ).rejects.toMatchObject({ code: 'MALFORMED_STREAM' });
  });

  it('首个 delta 后的流错误不可自动重试', async () => {
    const stream =
      'data: {"choices":[{"delta":{"content":"部分"}}]}\n\n' +
      'data: {bad}\n\n';
    const adapter = new OpenAiCompatibleAdapter({
      baseUrl: 'https://example.test',
      apiKey: 'secret',
      timeoutMs: 1000,
      fetch: jest.fn().mockResolvedValue(new Response(chunked(stream))),
    });
    await expect(
      collect(
        adapter.streamChat(
          { model: 'x', messages: [] },
          new AbortController().signal,
        ),
      ),
    ).rejects.toMatchObject({
      code: 'MALFORMED_STREAM',
      retryableBeforeFirstDelta: false,
    });
  });

  it.each([
    [400, 'INVALID_REQUEST', false],
    [401, 'AUTHENTICATION_FAILED', false],
    [402, 'INSUFFICIENT_BALANCE', false],
    [422, 'INVALID_REQUEST', false],
    [429, 'RATE_LIMITED', true],
    [500, 'OVERLOADED', true],
    [503, 'OVERLOADED', true],
  ])('映射 HTTP %s', (status, code, retryable) => {
    expect(mapHttpError(status)).toMatchObject({
      code,
      retryableBeforeFirstDelta: retryable,
      httpStatus: status,
    });
  });

  it('取消时中止上游 fetch', async () => {
    const controller = new AbortController();
    const fetchMock = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const adapter = new OpenAiCompatibleAdapter({
      baseUrl: 'https://example.test',
      apiKey: 'secret',
      timeoutMs: 1000,
      fetch: fetchMock as typeof fetch,
    });
    const result = collect(
      adapter.streamChat({ model: 'x', messages: [] }, controller.signal),
    );
    controller.abort();
    await expect(result).rejects.toBeInstanceOf(ProviderError);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(
      true,
    );
  });
});

function chunked(
  text: string,
  sizes: number[] = [],
): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= text.length) return controller.close();
      const size = sizes.shift() ?? text.length;
      controller.enqueue(encoder.encode(text.slice(offset, offset + size)));
      offset += size;
    },
  });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}
