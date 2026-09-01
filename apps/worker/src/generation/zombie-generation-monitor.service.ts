/** 扫描超时 generation，将失效任务安全转换为失败并发布终止事件。 */

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
import { metrics } from '@chat/observability';
import { WORKER_ENV } from '../config/worker-config';
import { PrismaService } from '../database/prisma.service';
import { GENERATION_QUEUE_NAME } from './generation.constants';
import { enqueueTerminalEvent } from './terminal-event-outbox';

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
      connection: redisConnectionOptions(environment.QUEUE_REDIS_URL),
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

  /** 查找心跳超时的活动任务，并通过条件更新避免误杀已恢复或已结束的任务。 */
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
        select: {
          id: true,
          userId: true,
          conversationId: true,
          responseMessageId: true,
          writerToken: true,
          responseMessage: {
            select: { content: true, reasoningContent: true },
          },
        },
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
            await transaction.conversationUserState.update({
              where: {
                conversationId_userId: {
                  conversationId: generation.conversationId,
                  userId: generation.userId,
                },
              },
              data: { hasUnread: true },
            });
            await enqueueTerminalEvent(transaction, {
              userId: generation.userId,
              conversationId: generation.conversationId,
              generationId: generation.id,
              messageId: generation.responseMessageId,
              type: 'generation.failed',
              payload: {
                code: 'WORKER_LOST',
                retryable: false,
                safeMessage: '生成进程意外中断，已保留收到的部分内容',
              },
              content: generation.responseMessage.content,
              reasoningContent: generation.responseMessage.reasoningContent,
              status: 'FAILED',
            });
            return true;
          },
        );
        if (transitioned) {
          recovered += 1;
          metrics.increment('chat_generation_worker_lost_total');
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
