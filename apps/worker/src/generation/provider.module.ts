import type { WorkerEnv } from '@chat/config';
import {
  OpenAiCompatibleAdapter,
  type LlmProviderAdapter,
  type NormalizedChatRequest,
  type NormalizedLlmEvent,
} from '@chat/llm';
import { Module } from '@nestjs/common';
import { WORKER_ENV } from '../config/worker-config';
import { LLM_PROVIDER_ADAPTER } from './generation.constants';

@Module({
  providers: [
    {
      provide: LLM_PROVIDER_ADAPTER,
      inject: [WORKER_ENV],
      useFactory: (environment: WorkerEnv) => {
        if (environment.NODE_ENV === 'test') return new BrowserE2eProvider();
        return new OpenAiCompatibleAdapter({
          baseUrl: environment.LLM_BASE_URL,
          apiKey: environment.LLM_API_KEY,
          timeoutMs: environment.LLM_REQUEST_TIMEOUT_MS,
        });
      },
    },
  ],
  exports: [LLM_PROVIDER_ADAPTER],
})
export class ProviderModule {}

/** 仅供自动化浏览器测试使用，禁止在开发或生产环境注入。 */
class BrowserE2eProvider implements LlmProviderAdapter {
  async *streamChat(
    request: NormalizedChatRequest,
    signal?: AbortSignal,
  ): AsyncIterable<NormalizedLlmEvent> {
    const latestPrompt =
      request.messages.findLast((message) => message.role === 'user')
        ?.content ?? '';
    const isBrowserStreamingRegression = /^浏览器长流式回归 [AB]$/.test(
      latestPrompt,
    );
    const events: NormalizedLlmEvent[] = isBrowserStreamingRegression
      ? Array.from({ length: 100 }, (_, index) => ({
          type: 'content_delta' as const,
          delta: `流式片段-${index + 1} ${'甲'.repeat(120)}`,
        }))
      : [
          { type: 'reasoning_delta', delta: '安全分析' } as const,
          { type: 'content_delta', delta: '这是实时' } as const,
          { type: 'content_delta', delta: '流式回复。' } as const,
        ];
    for (const event of events) {
      await new Promise((resolve) =>
        setTimeout(resolve, isBrowserStreamingRegression ? 20 : 200),
      );
      if (signal?.aborted) throw signal.reason;
      yield event;
    }
    yield { type: 'finish', finishReason: 'stop', providerRequestId: 'e2e' };
  }
}
