/** 以短事务领取 Outbox，在事务外投递，再以短事务确认结果。 */

import type { ApiEnv } from '@chat/config';
import {
  generationJobSchema,
  generationTerminalOutboxPayloadSchema,
  type GenerationJob,
} from '@chat/contracts';
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
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { API_ENV } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { eventKeys } from '../events/event-keys';
import { GENERATION_QUEUE, OUTBOX_EVENT_REDIS } from './outbox.constants';

interface ClaimedOutboxRow {
  id: string;
  aggregate_id: string;
  type: string;
  payload: Prisma.JsonValue;
  attempts: number;
}

const TERMINAL_PUBLISH_SCRIPT = `
local prior = redis.call('GET', KEYS[5])
if prior then
  local decoded = cjson.decode(prior)
  return { tostring(decoded[1]), decoded[2], decoded[3] }
end
local sequence = redis.call('INCR', KEYS[1])
local generation_id = tostring(sequence) .. '-0'
local event = cjson.decode(ARGV[1])
event.sequence = sequence
redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])
redis.call('XADD', KEYS[3], generation_id, 'event', cjson.encode(event))
local user_id = redis.call('XADD', KEYS[4], '*', 'event', cjson.encode(event))
redis.call('XTRIM', KEYS[4], 'MINID', ARGV[4] .. '-0')
redis.call('PEXPIRE', KEYS[1], ARGV[3])
redis.call('PEXPIRE', KEYS[3], ARGV[3])
redis.call('PEXPIRE', KEYS[4], ARGV[3])
redis.call('SET', KEYS[5], cjson.encode({sequence, generation_id, user_id}), 'PX', ARGV[3])
return { tostring(sequence), generation_id, user_id }
`;

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
    @Inject(OUTBOX_EVENT_REDIS) private readonly eventRedis: Redis,
    @Inject(API_ENV) private readonly environment: ApiEnv,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.environment.OUTBOX_RELAY_ENABLED) return;
    this.timer = setInterval(() => {
      void this.dispatchOnce().catch(() => {
        this.logger.warn('Outbox Relay 暂时不可用，将在下一周期恢复');
      });
    }, this.environment.OUTBOX_DISPATCH_INTERVAL_MS);
    this.timer.unref();
    void this.dispatchOnce().catch(() => {
      this.logger.warn('Outbox Relay 初次投递失败，将在下一周期恢复');
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.queue.close();
    if (this.eventRedis.status === 'ready') await this.eventRedis.quit();
    else this.eventRedis.disconnect();
  }

  async dispatchOnce(): Promise<number> {
    if (this.dispatching) return 0;
    this.dispatching = true;
    const lockToken = randomUUID();
    try {
      const rows = await this.claim(lockToken);
      let published = 0;
      for (const row of rows) {
        try {
          const sequence = await this.publish(row);
          await this.acknowledge(row, lockToken, sequence);
          metrics.increment('chat_outbox_deliveries_total', { type: row.type });
          published += 1;
        } catch (error) {
          await this.fail(row, lockToken, this.safeError(error));
        }
      }
      await this.recordBacklogMetrics();
      return published;
    } finally {
      this.dispatching = false;
    }
  }

  /** 领取只修改数据库租约，不在事务内等待 Redis。 */
  private async claim(lockToken: string): Promise<ClaimedOutboxRow[]> {
    const staleBefore = new Date(
      Date.now() - this.environment.OUTBOX_LOCK_TIMEOUT_MS,
    );
    return this.prisma.$transaction((transaction) =>
      transaction.$queryRaw<ClaimedOutboxRow[]>(Prisma.sql`
        WITH candidates AS (
          SELECT "id"
          FROM "outbox_events"
          WHERE "published_at" IS NULL
            AND "dead_lettered_at" IS NULL
            AND "next_attempt_at" <= NOW()
            AND ("locked_at" IS NULL OR "locked_at" < ${staleBefore})
          ORDER BY "created_at" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${this.environment.OUTBOX_DISPATCH_BATCH_SIZE}
        )
        UPDATE "outbox_events" AS event
        SET "locked_at" = NOW(), "lock_token" = ${lockToken}::uuid
        FROM candidates
        WHERE event."id" = candidates."id"
        RETURNING event."id", event."aggregate_id", event."type", event."payload", event."attempts"
      `),
    );
  }

  private async publish(row: ClaimedOutboxRow): Promise<number | null> {
    if (row.type === 'generation.enqueue') {
      const parsed = generationJobSchema.safeParse(row.payload);
      if (!parsed.success || parsed.data.generationId !== row.aggregate_id) {
        throw new Error('INVALID_PAYLOAD');
      }
      await this.queue.add('generate', parsed.data, {
        jobId: parsed.data.generationId,
        attempts: 5,
        backoff: { type: 'exponential', delay: 500 },
        removeOnComplete: {
          count: this.environment.GENERATION_QUEUE_COMPLETED_RETENTION_COUNT,
        },
        removeOnFail: {
          count: this.environment.GENERATION_QUEUE_FAILED_RETENTION_COUNT,
        },
      });
      return null;
    }

    const parsed = generationTerminalOutboxPayloadSchema.safeParse(row.payload);
    if (!parsed.success || parsed.data.generationId !== row.aggregate_id) {
      throw new Error('INVALID_PAYLOAD');
    }
    if (parsed.data.type !== row.type) throw new Error('INVALID_EVENT_TYPE');
    const event = {
      version: 1 as const,
      eventId: row.id,
      streamId: '0-0',
      type: parsed.data.type,
      conversationId: parsed.data.conversationId,
      generationId: parsed.data.generationId,
      messageId: parsed.data.messageId,
      sequence: 0,
      occurredAt: new Date().toISOString(),
      payload: parsed.data.payload,
    };
    const keys = eventKeys(
      this.environment.EVENT_KEY_PREFIX,
      parsed.data.userId,
      parsed.data.generationId,
    );
    const dedupeKey = `${this.environment.EVENT_KEY_PREFIX}:{${parsed.data.userId}}:event-dedupe:${row.id}`;
    const result = (await this.eventRedis.eval(
      TERMINAL_PUBLISH_SCRIPT,
      5,
      keys.sequence!,
      keys.state!,
      keys.generationStream!,
      keys.userStream,
      dedupeKey,
      JSON.stringify(event),
      JSON.stringify(parsed.data.state),
      String(this.environment.EVENT_RETENTION_MS),
      String(Date.now() - this.environment.EVENT_RETENTION_MS),
    )) as [string, string, string];
    return Number(result[0]);
  }

  private async acknowledge(
    row: ClaimedOutboxRow,
    lockToken: string,
    sequence: number | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      if (sequence !== null) {
        await transaction.generation.updateMany({
          where: { id: row.aggregate_id, checkpointSequence: { lt: sequence } },
          data: { lastSequence: sequence, checkpointSequence: sequence },
        });
      }
      await transaction.outboxEvent.updateMany({
        where: { id: row.id, lockToken, publishedAt: null },
        data: {
          publishedAt: new Date(),
          attempts: { increment: 1 },
          lastError: null,
          lockedAt: null,
          lockToken: null,
        },
      });
    });
  }

  private async fail(
    row: ClaimedOutboxRow,
    lockToken: string,
    errorCode: string,
  ): Promise<void> {
    const attempts = row.attempts + 1;
    const deadLettered =
      errorCode.startsWith('INVALID_') ||
      attempts >= this.environment.OUTBOX_MAX_ATTEMPTS;
    const delay = Math.min(60_000, 500 * 2 ** Math.min(attempts - 1, 7));
    await this.prisma.outboxEvent.updateMany({
      where: { id: row.id, lockToken, publishedAt: null },
      data: {
        attempts: { increment: 1 },
        lastError: errorCode,
        nextAttemptAt: new Date(Date.now() + delay),
        deadLetteredAt: deadLettered ? new Date() : null,
        lockedAt: null,
        lockToken: null,
      },
    });
    this.logger.warn(
      `Outbox 投递失败 eventId=${row.id} code=${errorCode} deadLettered=${deadLettered}`,
    );
    metrics.increment('chat_outbox_delivery_failures_total', {
      type: row.type,
      code: errorCode,
    });
  }

  private async recordBacklogMetrics(): Promise<void> {
    const [unpublishedCount, deadLetterCount, oldest] = await Promise.all([
      this.prisma.outboxEvent.count({
        where: { publishedAt: null, deadLetteredAt: null },
      }),
      this.prisma.outboxEvent.count({
        where: { publishedAt: null, deadLetteredAt: { not: null } },
      }),
      this.prisma.outboxEvent.findFirst({
        where: { publishedAt: null, deadLetteredAt: null },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);
    metrics.gauge('chat_outbox_unpublished_count', unpublishedCount, {
      service: 'api',
    });
    metrics.gauge('chat_outbox_dead_letter_count', deadLetterCount, {
      service: 'api',
    });
    metrics.gauge(
      'chat_outbox_oldest_unpublished_seconds',
      oldest
        ? Math.max(0, (Date.now() - oldest.createdAt.getTime()) / 1_000)
        : 0,
      { service: 'api' },
    );
  }

  private safeError(error: unknown): string {
    if (error instanceof Error && /^INVALID_[A-Z_]+$/.test(error.message)) {
      return error.message;
    }
    return 'DELIVERY_FAILED';
  }
}
