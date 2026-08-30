/** 轮询数据库 Outbox，以幂等方式把待生成任务投递到 BullMQ。 */

import type { ApiEnv } from '@chat/config';
import { generationJobSchema, type GenerationJob } from '@chat/contracts';
import { Prisma } from '@chat/database';
import { metrics } from '@chat/observability';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { API_ENV } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { GENERATION_QUEUE } from './outbox.constants';

interface PendingOutboxRow {
  id: string;
  aggregate_id: string;
  payload: Prisma.JsonValue;
}

@Injectable()
export class OutboxDispatcherService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(OutboxDispatcherService.name);
  private timer?: NodeJS.Timeout;
  private dispatching = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(GENERATION_QUEUE) private readonly queue: Queue<GenerationJob>,
    @Inject(API_ENV) private readonly environment: ApiEnv,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.dispatchOnce().catch(() => {
        this.logger.warn('Outbox Dispatcher 暂时不可用，将在下一周期恢复');
      });
    }, this.environment.OUTBOX_DISPATCH_INTERVAL_MS);
    this.timer.unref();
    void this.dispatchOnce().catch(() => {
      this.logger.warn('Outbox 初次投递失败，将在下一周期恢复');
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.queue.close();
  }

  /**
   * 锁定一批未发布 Outbox 并投递 BullMQ；SKIP LOCKED 允许多个实例并行分片处理。
   */
  /** 锁定一批待投递记录；队列 jobId 去重后才标记 Outbox 已发送。 */
  async dispatchOnce(): Promise<number> {
    if (this.dispatching) return 0;
    this.dispatching = true;
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const rows = await transaction.$queryRaw<PendingOutboxRow[]>(Prisma.sql`
          SELECT "id", "aggregate_id", "payload"
          FROM "outbox_events"
          WHERE "published_at" IS NULL
            AND "type" = 'generation.enqueue'
          ORDER BY "created_at" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${this.environment.OUTBOX_DISPATCH_BATCH_SIZE}
        `);
        let published = 0;
        for (const row of rows) {
          const parsed = generationJobSchema.safeParse(row.payload);
          if (
            !parsed.success ||
            parsed.data.generationId !== row.aggregate_id
          ) {
            await transaction.outboxEvent.update({
              where: { id: row.id },
              data: {
                attempts: { increment: 1 },
                lastError: 'INVALID_PAYLOAD',
              },
            });
            continue;
          }
          try {
            /**
             * generationId 同时作为 jobId，使 Outbox 重投不会创建重复队列任务。
             */
            await this.queue.add('generate', parsed.data, {
              jobId: parsed.data.generationId,
              attempts: 5,
              backoff: { type: 'exponential', delay: 500 },
              removeOnComplete: {
                count:
                  this.environment.GENERATION_QUEUE_COMPLETED_RETENTION_COUNT,
              },
              removeOnFail: {
                count: this.environment.GENERATION_QUEUE_FAILED_RETENTION_COUNT,
              },
            });
            await transaction.outboxEvent.update({
              where: { id: row.id },
              data: {
                publishedAt: new Date(),
                attempts: { increment: 1 },
                lastError: null,
              },
            });
            published += 1;
          } catch {
            await transaction.outboxEvent.update({
              where: { id: row.id },
              data: {
                attempts: { increment: 1 },
                lastError: 'QUEUE_PUBLISH_FAILED',
              },
            });
            this.logger.warn(`Outbox 投递失败 eventId=${row.id}`);
          }
        }
        const [unpublishedCount, oldest] = await Promise.all([
          transaction.outboxEvent.count({ where: { publishedAt: null } }),
          transaction.outboxEvent.findFirst({
            where: { publishedAt: null },
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
          }),
        ]);
        metrics.gauge('chat_outbox_unpublished_count', unpublishedCount, {
          service: 'api',
        });
        metrics.gauge(
          'chat_outbox_oldest_unpublished_seconds',
          oldest
            ? Math.max(0, (Date.now() - oldest.createdAt.getTime()) / 1_000)
            : 0,
          { service: 'api' },
        );
        return published;
      });
    } finally {
      this.dispatching = false;
    }
  }
}
