/** 提供自动化测试可编排的假 LLM 供应商适配器。 */

import {
  ProviderError,
  type LlmProviderAdapter,
  type NormalizedChatRequest,
  type NormalizedLlmEvent,
  type ProviderErrorCode,
} from '@chat/llm';

export type FakeProviderStep =
  | { event: NormalizedLlmEvent; delayMs?: number }
  | {
      error: ProviderErrorCode;
      retryableBeforeFirstDelta?: boolean;
      delayMs?: number;
    };

export class FakeLlmProvider implements LlmProviderAdapter {
  readonly requests: NormalizedChatRequest[] = [];

  constructor(
    private readonly steps: FakeProviderStep[],
    private readonly attemptScripts?: FakeProviderStep[][],
  ) {}

  /** 按预设步骤可重复地产生增量、延迟或错误，并响应 AbortSignal。 */
  async *streamChat(
    request: NormalizedChatRequest,
    signal: AbortSignal,
  ): AsyncIterable<NormalizedLlmEvent> {
    const requestIndex = this.requests.length;
    this.requests.push(structuredClone(request));
    const steps =
      this.attemptScripts?.[requestIndex] ??
      this.attemptScripts?.at(-1) ??
      this.steps;
    for (const step of steps) {
      await abortableDelay(step.delayMs ?? 0, signal);
      if ('error' in step) {
        throw new ProviderError({
          code: step.error,
          retryableBeforeFirstDelta: step.retryableBeforeFirstDelta ?? true,
          safeMessage: 'Fake Provider 注入错误',
        });
      }
      yield structuredClone(step.event);
    }
  }

  static text(text: string, intervalMs = 0): FakeLlmProvider {
    return new FakeLlmProvider([
      ...Array.from(text, (delta) => ({
        event: { type: 'content_delta', delta } as const,
        delayMs: intervalMs,
      })),
      { event: { type: 'finish', finishReason: 'stop' } },
    ]);
  }

  static attempts(scripts: FakeProviderStep[][]): FakeLlmProvider {
    return new FakeLlmProvider([], scripts);
  }
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
