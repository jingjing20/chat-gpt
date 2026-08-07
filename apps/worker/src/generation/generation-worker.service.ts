import { redisConnectionOptions, type WorkerEnv } from '@chat/config';
import { generationJobSchema, type GenerationJob } from '@chat/contracts';
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

  onApplicationBootstrap(): void {
    this.worker = new Worker<GenerationJob>(
      GENERATION_QUEUE_NAME,
      async (job) => {
        const payload = generationJobSchema.parse(job.data);
        await this.processor.process(payload.generationId);
      },
      {
        connection: redisConnectionOptions(this.environment.REDIS_URL),
        prefix: this.environment.GENERATION_QUEUE_PREFIX,
        concurrency: this.environment.GENERATION_WORKER_CONCURRENCY,
      },
    );
    this.worker.on('failed', (job) => {
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
