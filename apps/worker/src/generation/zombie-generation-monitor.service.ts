import { redisConnectionOptions, type WorkerEnv } from '@chat/config';
import {
  GenerationAttemptStatus,
  GenerationStatus,
  MessageStatus,
} from '@chat/database';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { WORKER_ENV } from '../config/worker-config';
import { PrismaService } from '../database/prisma.service';
import { GENERATION_QUEUE_NAME } from './generation.constants';

@Injectable()
export class ZombieGenerationMonitorService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ZombieGenerationMonitorService.name);
  private readonly queue: Queue;
  private timer?: NodeJS.Timeout;
  private checking = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WORKER_ENV) private readonly environment: WorkerEnv,
  ) {
    this.queue = new Queue(GENERATION_QUEUE_NAME, {
      connection: redisConnectionOptions(environment.REDIS_URL),
      prefix: environment.GENERATION_QUEUE_PREFIX,
    });
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(
      () => void this.checkOnce(),
      Math.max(this.environment.GENERATION_HEARTBEAT_INTERVAL_MS, 1000),
    );
    this.timer.unref();
  }

  async checkOnce(): Promise<number> {
    if (this.checking) return 0;
    this.checking = true;
    try {
      const staleBefore = new Date(
        Date.now() - this.environment.GENERATION_HEARTBEAT_TIMEOUT_MS,
      );
      const stale = await this.prisma.generation.findMany({
        where: {
          status: {
            in: [GenerationStatus.STARTING, GenerationStatus.STREAMING],
          },
          writerToken: { not: null },
          writerHeartbeatAt: { lt: staleBefore },
        },
        select: { id: true, responseMessageId: true, writerToken: true },
        take: 100,
      });
      let recovered = 0;
      for (const generation of stale) {
        const job = await this.queue.getJob(generation.id);
        if (job && (await job.isActive())) continue;
        const now = new Date();
        const transitioned = await this.prisma.$transaction(
          async (transaction) => {
            const result = await transaction.generation.updateMany({
              where: {
                id: generation.id,
                writerToken: generation.writerToken,
                status: {
                  in: [GenerationStatus.STARTING, GenerationStatus.STREAMING],
                },
                writerHeartbeatAt: { lt: staleBefore },
              },
              data: {
                status: GenerationStatus.FAILED,
                errorCode: 'WORKER_LOST',
                errorDetailSafe: '生成进程意外中断，已保留收到的部分内容',
                completedAt: now,
                writerToken: null,
              },
            });
            if (result.count === 0) return false;
            await transaction.message.update({
              where: { id: generation.responseMessageId },
              data: { status: MessageStatus.FAILED, completedAt: now },
            });
            await transaction.generationAttempt.updateMany({
              where: {
                generationId: generation.id,
                status: GenerationAttemptStatus.STARTED,
                writerToken: generation.writerToken,
              },
              data: {
                status: GenerationAttemptStatus.FAILED,
                errorCode: 'WORKER_LOST',
                endedAt: now,
              },
            });
            return true;
          },
        );
        if (transitioned) {
          recovered += 1;
          this.logger.error(
            `僵尸 generation 已终结 generationId=${generation.id} code=WORKER_LOST`,
          );
        }
      }
      return recovered;
    } finally {
      this.checking = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.queue.close();
  }
}
