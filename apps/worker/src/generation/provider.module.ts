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
    _request: NormalizedChatRequest,
    signal?: AbortSignal,
  ): AsyncIterable<NormalizedLlmEvent> {
    for (const event of [
      { type: 'reasoning_delta', delta: '安全分析' } as const,
      { type: 'content_delta', delta: '这是实时' } as const,
      { type: 'content_delta', delta: '流式回复。' } as const,
    ]) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (signal?.aborted) throw signal.reason;
      yield event;
    }
    yield { type: 'finish', finishReason: 'stop', providerRequestId: 'e2e' };
  }
}
