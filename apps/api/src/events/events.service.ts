/** 从 Redis 重放用户事件、维持实时 SSE 连接并提供快照恢复数据。 */

import { redisConnectionOptions, type ApiEnv } from '@chat/config';
import {
  generationStatusSchema,
  userEventSchema,
  type GenerationEventHistory,
  type GenerationSyncResponse,
} from '@chat/contracts';
import { GenerationStatus } from '@chat/database';
import { metrics } from '@chat/observability';
import {
  HttpStatus,
  Inject,
  Injectable,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { API_ENV } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { ApiException } from '../http/api-exception';
import { eventKeys } from './event-keys';

@Injectable()
export class EventsService implements OnApplicationShutdown {
  private readonly redis: Redis;
  private readonly connections = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_ENV) private readonly environment: ApiEnv,
  ) {
    this.redis = new Redis({
      ...redisConnectionOptions(environment.CONTROL_REDIS_URL),
      lazyConnect: true,
    });
    this.redis.on('error', () => {
      metrics.increment('chat_redis_client_errors_total', {
        service: 'api',
        component: 'events',
      });
    });
  }

  /**
   * 将用户级 Redis Stream 转为可恢复 SSE，并限制连接数、缓冲区和 drain 等待时间。
   */
  /** 先重放游标后的历史事件，再阻塞读取新事件，并用心跳维持 SSE 连接。 */
  async stream(
    userId: string,
    after: string,
    request: Request,
    response: Response,
  ): Promise<void> {
    const leaseToken = randomUUID();
    let leaseAcquired: boolean;
    try {
      leaseAcquired = await this.acquireConnectionLease(userId, leaseToken);
    } catch {
      throw new ApiException(
        'SSE_LEASE_UNAVAILABLE',
        '实时连接安全服务暂时不可用，请稍后重试',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!leaseAcquired) {
      throw new ApiException(
        'SSE_CONNECTION_LIMIT',
        '实时连接数已达上限，请关闭其他页面后重试',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const connectionCount = this.connections.get(userId) ?? 0;
    this.connections.set(userId, connectionCount + 1);
    this.recordConnectionCount();
    response.status(200);
    response.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    const client = this.redis.duplicate();
    client.on('error', () => {
      metrics.increment('chat_redis_client_errors_total', {
        service: 'api',
        component: 'sse_stream',
      });
    });
    let cursor = after;
    let closed = false;
    const connectedAt = Date.now();
    request.on('close', () => {
      closed = true;
      client.disconnect();
    });
    try {
      while (!closed) {
        if (!(await this.acquireConnectionLease(userId, leaseToken))) {
          throw new ApiException(
            'SSE_CONNECTION_LEASE_LOST',
            '实时连接租约已失效，请重新连接',
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }
        const result = await client.xread(
          'COUNT',
          100,
          'BLOCK',
          this.environment.EVENT_HEARTBEAT_MS,
          'STREAMS',
          eventKeys(this.environment.EVENT_KEY_PREFIX, userId).userStream,
          cursor,
        );
        if (!result) {
          await this.writeWithBackpressure(
            response,
            `: heartbeat ${Math.floor(Date.now() / 1000)}\n\n`,
          );
          continue;
        }
        for (const [, entries] of result) {
          for (const [streamId, fields] of entries) {
            const raw = this.field(fields, 'event');
            if (!raw) continue;
            const event = userEventSchema.parse({
              ...JSON.parse(raw),
              streamId,
            });
            const occurredAt = Date.parse(event.occurredAt);
            if (occurredAt >= connectedAt) {
              metrics.observe(
                'chat_event_forward_latency_seconds',
                Math.max(0, Date.now() - occurredAt) / 1000,
                { type: event.type },
              );
            } else {
              metrics.increment('chat_event_replayed_total', {
                type: event.type,
              });
            }
            await this.writeWithBackpressure(
              response,
              `id: ${streamId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            );
            cursor = streamId;
          }
        }
      }
    } catch (error) {
      if (!closed) throw error;
    } finally {
      const remaining = (this.connections.get(userId) ?? 1) - 1;
      if (remaining <= 0) this.connections.delete(userId);
      else this.connections.set(userId, remaining);
      this.recordConnectionCount();
      await this.releaseConnectionLease(userId, leaseToken).catch(() => {
        metrics.increment('chat_sse_lease_release_failures_total');
      });
      client.disconnect();
      if (!response.writableEnded) response.end();
    }
  }

  /** 使用带 TTL 的 Redis ZSET 租约，使连接上限跨 API 实例生效。 */
  private async acquireConnectionLease(
    userId: string,
    token: string,
  ): Promise<boolean> {
    const key = `${this.environment.EVENT_KEY_PREFIX}:sse:${userId}`;
    const now = Date.now();
    const ttl = Math.max(this.environment.EVENT_HEARTBEAT_MS * 3, 60_000);
    const acquired = Number(
      await this.redis.eval(
        `
        redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
        if redis.call('ZSCORE', KEYS[1], ARGV[2]) then
          redis.call('ZADD', KEYS[1], ARGV[3], ARGV[2])
          redis.call('PEXPIRE', KEYS[1], ARGV[4])
          return 1
        end
        if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[5]) then return 0 end
        redis.call('ZADD', KEYS[1], ARGV[3], ARGV[2])
        redis.call('PEXPIRE', KEYS[1], ARGV[4])
        return 1
        `,
        1,
        key,
        now,
        token,
        now + ttl,
        ttl + 1_000,
        this.environment.SSE_MAX_CONNECTIONS_PER_USER,
      ),
    );
    metrics.gauge('chat_sse_lease_occupied', acquired, { service: 'api' });
    return acquired === 1;
  }

  private async releaseConnectionLease(
    userId: string,
    token: string,
  ): Promise<void> {
    await this.redis.zrem(
      `${this.environment.EVENT_KEY_PREFIX}:sse:${userId}`,
      token,
    );
  }

  /**
   * 等待响应缓冲区排空；客户端持续过慢时主动断开，让其通过游标重新追赶。
   */
  /** 尊重 HTTP 响应背压；客户端断开时立即停止继续读取 Redis。 */
  private async writeWithBackpressure(
    response: Response,
    chunk: string,
  ): Promise<void> {
    if (
      response.writableLength + Buffer.byteLength(chunk) >
      this.environment.SSE_MAX_BUFFER_BYTES
    ) {
      throw new ApiException(
        'SSE_CLIENT_TOO_SLOW',
        '实时连接消费过慢，请重新连接以恢复内容',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (response.write(chunk)) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new ApiException(
            'SSE_CLIENT_TOO_SLOW',
            '实时连接消费过慢，请重新连接以恢复内容',
            HttpStatus.SERVICE_UNAVAILABLE,
          ),
        );
      }, this.environment.SSE_DRAIN_TIMEOUT_MS);
      const cleanup = () => {
        clearTimeout(timer);
        response.off('drain', onDrain);
        response.off('close', onClose);
      };
      const onDrain = () => {
        cleanup();
        resolve();
      };
      const onClose = () => {
        cleanup();
        resolve();
      };
      response.once('drain', onDrain);
      response.once('close', onClose);
    });
  }

  /**
   * 校验 generation 归属后读取连续事件；历史被裁剪时降级为 Redis/数据库快照。
   */
  /** 在保留窗口内返回精确事件，否则返回 replace 语义的权威快照。 */
  async history(
    userId: string,
    generationId: string,
    afterSequence: number,
  ): Promise<GenerationEventHistory> {
    metrics.increment('chat_generation_resync_total');
    const generation = await this.prisma.generation.findFirst({
      where: { id: generationId, userId },
      include: { responseMessage: true },
    });
    if (!generation) {
      throw new ApiException(
        'NOT_FOUND',
        'Generation 不存在',
        HttpStatus.NOT_FOUND,
      );
    }
    const keys = eventKeys(
      this.environment.EVENT_KEY_PREFIX,
      userId,
      generationId,
    );
    const recovery = (await this.redis.eval(
      `
      return {
        redis.call('XRANGE', KEYS[1], ARGV[1], '+'),
        redis.call('GET', KEYS[2]) or '',
        redis.call('GET', KEYS[3]) or ''
      }
      `,
      3,
      keys.generationStream!,
      keys.state!,
      keys.sequence!,
      `(${afterSequence}-0`,
    )) as [Array<[string, string[]]>, string, string];
    const [rows, rawState, rawSequence] = recovery;
    const events = rows.flatMap(([streamId, fields]) => {
      const raw = this.field(fields, 'event');
      if (!raw) return [];
      return [userEventSchema.parse({ ...JSON.parse(raw), streamId })];
    });
    const latestSequence = rawSequence
      ? Number(rawSequence)
      : Number(generation.lastSequence);
    const isContiguous = events.every(
      (event, index) => event.sequence === afterSequence + index + 1,
    );
    if (
      (events.length === 0 && afterSequence === latestSequence) ||
      (events.length > 0 && isContiguous)
    ) {
      metrics.increment('chat_generation_resync_results_total', {
        mode: 'events',
      });
      return {
        mode: 'events',
        events,
        lastSequence: events.at(-1)?.sequence ?? latestSequence,
      };
    }
    const state = rawState
      ? (JSON.parse(rawState) as Record<string, unknown>)
      : {};
    metrics.increment('chat_generation_resync_results_total', {
      mode: 'snapshot',
    });
    return {
      mode: 'snapshot',
      snapshot: {
        content:
          typeof state.content === 'string'
            ? state.content
            : generation.responseMessage.content,
        reasoningContent:
          typeof state.reasoningContent === 'string'
            ? state.reasoningContent
            : generation.responseMessage.reasoningContent,
        sequence: latestSequence,
        status: generationStatusSchema
          .catch(generation.status)
          .parse(state.status),
      },
    };
  }

  /**
   * 先固定用户流尾游标，再读取活动任务快照，消除“同步完成到开流之间”的丢事件窗口。
   */
  /** 汇总用户全部活动 generation 快照，供刷新或新标签页恢复。 */
  async sync(
    userId: string,
    knownGenerationIds: string[] = [],
  ): Promise<GenerationSyncResponse> {
    const userStream = eventKeys(
      this.environment.EVENT_KEY_PREFIX,
      userId,
    ).userStream;
    const initialTail = await this.redis.xrevrange(
      userStream,
      '+',
      '-',
      'COUNT',
      1,
    );
    const eventCursor = initialTail[0]?.[0] ?? '0-0';
    const [active, reconciled] = await Promise.all([
      this.prisma.generation.findMany({
        where: {
          userId,
          status: {
            in: [
              GenerationStatus.QUEUED,
              GenerationStatus.STARTING,
              GenerationStatus.STREAMING,
              GenerationStatus.CANCEL_REQUESTED,
            ],
          },
        },
        include: { responseMessage: true },
      }),
      this.prisma.generation.findMany({
        where: { userId, id: { in: knownGenerationIds } },
        include: { responseMessage: true },
      }),
    ]);
    const snapshotKeys = active.flatMap((generation) => {
      const keys = eventKeys(
        this.environment.EVENT_KEY_PREFIX,
        userId,
        generation.id,
      );
      return [keys.state!, keys.sequence!];
    });
    const values = (await this.redis.eval(
      `
      local result = {}
      for i = 1, #KEYS do
        table.insert(result, redis.call('GET', KEYS[i]) or '')
      end
      return result
      `,
      snapshotKeys.length,
      ...snapshotKeys,
    )) as string[];
    const correctedTerminalCount = reconciled.filter(
      (generation) =>
        generation.status === GenerationStatus.COMPLETED ||
        generation.status === GenerationStatus.FAILED ||
        generation.status === GenerationStatus.CANCELLED,
    ).length;
    if (correctedTerminalCount > 0) {
      metrics.increment(
        'chat_generation_sync_reconciliations_total',
        {},
        correctedTerminalCount,
      );
    }
    return {
      eventCursor,
      activeGenerations: active.map((generation, index) => {
        const raw = values[index * 2];
        const redisSequence = values[index * 2 + 1];
        const state = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        return {
          generationId: generation.id,
          conversationId: generation.conversationId,
          messageId: generation.responseMessageId,
          status: generationStatusSchema
            .catch(generation.status)
            .parse(state.status),
          content:
            typeof state.content === 'string'
              ? state.content
              : generation.responseMessage.content,
          reasoningContent:
            typeof state.reasoningContent === 'string'
              ? state.reasoningContent
              : generation.responseMessage.reasoningContent,
          sequence: redisSequence
            ? Number(redisSequence)
            : Number(generation.lastSequence),
        };
      }),
      reconciledGenerations: reconciled.map((generation) => ({
        generationId: generation.id,
        conversationId: generation.conversationId,
        messageId: generation.responseMessageId,
        status: generation.status,
        content: generation.responseMessage.content,
        reasoningContent: generation.responseMessage.reasoningContent,
        sequence: Number(generation.lastSequence),
        error: generation.errorDetailSafe,
      })),
    };
  }

  private field(fields: string[], name: string): string | undefined {
    const index = fields.indexOf(name);
    return index >= 0 ? fields[index + 1] : undefined;
  }

  private recordConnectionCount(): void {
    metrics.gauge(
      'chat_sse_connections',
      [...this.connections.values()].reduce((total, value) => total + value, 0),
      { service: 'api' },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'ready') await this.redis.quit();
    else this.redis.disconnect();
  }
}
