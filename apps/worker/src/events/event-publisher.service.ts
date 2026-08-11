import { redisConnectionOptions, type WorkerEnv } from '@chat/config';
import type { GenerationEventType, UserEvent } from '@chat/contracts';
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { WORKER_ENV } from '../config/worker-config';
import { eventKeys } from './event-keys';

const PUBLISH_SCRIPT = `
local sequence = redis.call('INCR', KEYS[1])
local generation_id = tostring(sequence) .. '-0'
local event = cjson.decode(ARGV[1])
event.sequence = sequence
redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])
redis.call('XADD', KEYS[3], generation_id, 'event', cjson.encode(event))
local user_id = redis.call('XADD', KEYS[4], '*', 'event', cjson.encode(event))
local minimum_id = ARGV[4] .. '-0'
redis.call('XTRIM', KEYS[4], 'MINID', minimum_id)
redis.call('PEXPIRE', KEYS[1], ARGV[3])
redis.call('PEXPIRE', KEYS[3], ARGV[3])
redis.call('PEXPIRE', KEYS[4], ARGV[3])
return { tostring(sequence), generation_id, user_id }
`;

export interface PublishGenerationEventInput {
  userId: string;
  conversationId: string;
  generationId: string;
  messageId: string;
  type: GenerationEventType;
  payload: Record<string, unknown>;
  state: Record<string, unknown>;
}

@Injectable()
export class EventPublisherService implements OnApplicationShutdown {
  private readonly redis: Redis;

  constructor(@Inject(WORKER_ENV) environment: WorkerEnv) {
    this.redis = new Redis(redisConnectionOptions(environment.REDIS_URL));
    this.prefix = environment.EVENT_KEY_PREFIX;
    this.retentionMs = environment.EVENT_RETENTION_MS;
  }

  private readonly prefix: string;
  private readonly retentionMs: number;

  async publish(input: PublishGenerationEventInput): Promise<UserEvent> {
    const keys = eventKeys(this.prefix, input.userId, input.generationId);
    const base = {
      version: 1 as const,
      eventId: randomUUID(),
      streamId: '0-0',
      type: input.type,
      conversationId: input.conversationId,
      generationId: input.generationId,
      messageId: input.messageId,
      sequence: 0,
      occurredAt: new Date().toISOString(),
      payload: input.payload,
    };
    const result = (await this.redis.eval(
      PUBLISH_SCRIPT,
      4,
      keys.sequence,
      keys.state,
      keys.generationStream,
      keys.userStream,
      JSON.stringify(base),
      JSON.stringify(input.state),
      String(this.retentionMs),
      String(Date.now() - this.retentionMs),
    )) as [string, string, string];
    return { ...base, sequence: Number(result[0]), streamId: result[2] };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
