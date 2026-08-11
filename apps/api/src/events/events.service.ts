import { redisConnectionOptions, type ApiEnv } from '@chat/config';
import {
  generationStatusSchema,
  userEventSchema,
  type GenerationEventHistory,
  type GenerationSyncResponse,
} from '@chat/contracts';
import { GenerationStatus } from '@chat/database';
import {
  HttpStatus,
  Inject,
  Injectable,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import Redis from 'ioredis';
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
    this.redis = new Redis(redisConnectionOptions(environment.REDIS_URL));
  }

  async stream(
    userId: string,
    after: string,
    request: Request,
    response: Response,
  ): Promise<void> {
    const connectionCount = this.connections.get(userId) ?? 0;
    if (connectionCount >= this.environment.SSE_MAX_CONNECTIONS_PER_USER) {
      throw new ApiException(
        'SSE_CONNECTION_LIMIT',
        '实时连接数已达上限，请关闭其他页面后重试',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.connections.set(userId, connectionCount + 1);
    response.status(200);
    response.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    const client = this.redis.duplicate();
    let cursor = after;
    let closed = false;
    request.on('close', () => {
      closed = true;
      client.disconnect();
    });
    try {
      while (!closed) {
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
      client.disconnect();
      if (!response.writableEnded) response.end();
    }
  }

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

  async history(
    userId: string,
    generationId: string,
    afterSequence: number,
  ): Promise<GenerationEventHistory> {
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
    const latestSequence = Number(rawSequence ?? generation.lastSequence);
    const isContiguous = events.every(
      (event, index) => event.sequence === afterSequence + index + 1,
    );
    if (
      (events.length === 0 && afterSequence === latestSequence) ||
      (events.length > 0 && isContiguous)
    ) {
      return {
        mode: 'events',
        events,
        lastSequence: events.at(-1)?.sequence ?? latestSequence,
      };
    }
    const state = rawState
      ? (JSON.parse(rawState) as Record<string, unknown>)
      : {};
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

  async sync(userId: string): Promise<GenerationSyncResponse> {
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
    const active = await this.prisma.generation.findMany({
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
    });
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
          sequence: Number(redisSequence ?? generation.lastSequence),
        };
      }),
    };
  }

  private field(fields: string[], name: string): string | undefined {
    const index = fields.indexOf(name);
    return index >= 0 ? fields[index + 1] : undefined;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
