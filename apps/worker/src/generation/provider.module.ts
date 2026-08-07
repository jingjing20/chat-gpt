import type { WorkerEnv } from '@chat/config';
import { OpenAiCompatibleAdapter } from '@chat/llm';
import { Module } from '@nestjs/common';
import { WORKER_ENV } from '../config/worker-config';
import { LLM_PROVIDER_ADAPTER } from './generation.constants';

@Module({
  providers: [
    {
      provide: LLM_PROVIDER_ADAPTER,
      inject: [WORKER_ENV],
      useFactory: (environment: WorkerEnv) =>
        new OpenAiCompatibleAdapter({
          baseUrl: environment.LLM_BASE_URL,
          apiKey: environment.LLM_API_KEY,
          timeoutMs: environment.LLM_REQUEST_TIMEOUT_MS,
        }),
    },
  ],
  exports: [LLM_PROVIDER_ADAPTER],
})
export class ProviderModule {}
