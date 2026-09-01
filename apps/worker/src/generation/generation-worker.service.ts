/** 启动 BullMQ Worker，并把队列任务交给 generation 处理器。 */

import { redisConnectionOptions, type WorkerEnv } from '@chat/config';
import { generationJobSchema, type GenerationJob } from '@chat/contracts';
import {
  createTraceContext,
  metrics,
  runWithTelemetrySpan,
  runWithTrace,
} from '@chat/observability';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import { WORKER_ENV } from '../config/worker-config';
import { GENERATION_QUEUE_NAME } from './generation.constants';
import { GenerationProcessor } from './generation.processor';

@Injectable()
export class GenerationWorkerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(GenerationWorkerService.name);
  private worker?: Worker<GenerationJob>;

  constructor(
    private readonly processor: GenerationProcessor,
    @Inject(WORKER_ENV) private readonly environment: WorkerEnv,
  ) {}

  /**
   * 启动 BullMQ 消费者并按配置控制并发，实际供应商请求只在 Worker 进程执行。
   */
  onApplicationBootstrap(): void {
    this.worker = new Worker<GenerationJob>(
      GENERATION_QUEUE_NAME,
      async (job) => {
        const payload = generationJobSchema.parse(job.data);
        const startedAt = process.hrtime.bigint();
        const queueWaitSeconds =
          Math.max(0, Date.now() - job.timestamp) / 1_000;
        metrics.gauge(
          'chat_generation_queue_wait_seconds_last',
          queueWaitSeconds,
        );
        metrics.observe('chat_generation_queue_wait_seconds', queueWaitSeconds);
        await runWithTelemetrySpan(
          'generation.process',
          { 'generation.id': payload.generationId },
          (traceContext) =>
            runWithTrace(
              createTraceContext({
                ...traceContext,
                generationId: payload.generationId,
              }),
              () => this.processor.process(payload.generationId),
            ),
        );
        metrics.increment('chat_generation_jobs_total', {
          status: 'completed',
        });
        const durationSeconds =
          Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
        metrics.gauge('chat_generation_duration_seconds_last', durationSeconds);
        metrics.observe('chat_generation_duration_seconds', durationSeconds);
      },
      {
        connection: redisConnectionOptions(this.environment.QUEUE_REDIS_URL),
        prefix: this.environment.GENERATION_QUEUE_PREFIX,
        concurrency: this.environment.GENERATION_WORKER_CONCURRENCY,
      },
    );
    this.worker.on('failed', (job) => {
      metrics.increment('chat_generation_jobs_total', { status: 'failed' });
      this.logger.error(
        `Generation Job 失败 generationId=${job?.id ?? 'unknown'}`,
      );
    });
    this.worker.on('error', () => {
      this.logger.error('Generation Worker 队列连接异常');
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
