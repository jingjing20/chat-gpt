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
          response.write(`: heartbeat ${Math.floor(Date.now() / 1000)}\n\n`);
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
            response.write(
              `id: ${streamId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            );
            cursor = streamId;
          }
        }
      }
    } catch (error) {
      if (!closed) throw error;
    } finally {
      client.disconnect();
      if (!response.writableEnded) response.end();
    }
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
    const rows = await this.redis.xrange(
      keys.generationStream!,
      `(${afterSequence}-0`,
      '+',
    );
    const events = rows.flatMap(([streamId, fields]) => {
      const raw = this.field(fields, 'event');
      if (!raw) return [];
      return [userEventSchema.parse({ ...JSON.parse(raw), streamId })];
    });
    const first = events[0];
    if (first && first.sequence === afterSequence + 1) {
      return {
        mode: 'events',
        events,
        lastSequence: events.at(-1)!.sequence,
      };
    }
    return {
      mode: 'snapshot',
      snapshot: {
        content: generation.responseMessage.content,
        reasoningContent: generation.responseMessage.reasoningContent,
        sequence: Number(generation.lastSequence),
        status: generation.status,
      },
    };
  }

  async sync(userId: string): Promise<GenerationSyncResponse> {
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
    const userStream = eventKeys(
      this.environment.EVENT_KEY_PREFIX,
      userId,
    ).userStream;
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
      local tail = redis.call('XREVRANGE', KEYS[1], '+', '-', 'COUNT', 1)
      local result = { (#tail == 0 and '0-0' or tail[1][1]) }
      for i = 2, #KEYS do
        table.insert(result, redis.call('GET', KEYS[i]) or '')
      end
      return result
      `,
      1 + snapshotKeys.length,
      userStream,
      ...snapshotKeys,
    )) as string[];
    return {
      eventCursor: values[0] ?? '0-0',
      activeGenerations: active.map((generation, index) => {
        const raw = values[index * 2 + 1];
        const redisSequence = values[index * 2 + 2];
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
