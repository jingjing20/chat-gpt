/** 验证可编排假模型供应商的事件、错误、延迟和中止行为。 */

import { ProviderError } from '@chat/llm';
import { FakeLlmProvider } from './fake-provider';

const request = {
  model: 'fake',
  messages: [{ role: 'user' as const, content: '你好' }],
};

describe('FakeLlmProvider', () => {
  it('按脚本输出 reasoning、正文、usage 和完成事件', async () => {
    const provider = new FakeLlmProvider([
      { event: { type: 'reasoning_delta', delta: '思考' } },
      { event: { type: 'content_delta', delta: '回答' } },
      { event: { type: 'usage', usage: { totalTokens: 3 } } },
      { event: { type: 'finish', finishReason: 'stop' } },
    ]);
    const events = await collect(
      provider.streamChat(request, new AbortController().signal),
    );
    expect(events).toHaveLength(4);
    expect(provider.requests).toEqual([request]);
  });

  it('可以为连续上游尝试提供不同脚本', async () => {
    const provider = FakeLlmProvider.attempts([
      [{ error: 'RATE_LIMITED' }],
      [{ event: { type: 'finish', finishReason: 'stop' } }],
    ]);
    await expect(
      collect(provider.streamChat(request, new AbortController().signal)),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(
      collect(provider.streamChat(request, new AbortController().signal)),
    ).resolves.toEqual([{ type: 'finish', finishReason: 'stop' }]);
    expect(provider.requests).toHaveLength(2);
  });

  it('能在首个 delta 前和第 K 个 delta 后注入错误', async () => {
    const before = new FakeLlmProvider([{ error: 'RATE_LIMITED' }]);
    await expect(
      collect(before.streamChat(request, new AbortController().signal)),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    const after = new FakeLlmProvider([
      { event: { type: 'content_delta', delta: '部分' } },
      { error: 'CONNECTION_LOST', retryableBeforeFirstDelta: false },
    ]);
    await expect(
      collect(after.streamChat(request, new AbortController().signal)),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('响应 AbortSignal 并停止后续输出', async () => {
    const controller = new AbortController();
    const provider = FakeLlmProvider.text('很慢', 1000);
    const collecting = collect(provider.streamChat(request, controller.signal));
    controller.abort();
    await expect(collecting).rejects.toBeDefined();
  });
});

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}
