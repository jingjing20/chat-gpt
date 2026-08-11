import { redisConnectionOptions, type WorkerEnv } from '@chat/config';
import { EventPublisherService } from '../src/events/event-publisher.service';
import { eventKeys } from '../src/events/event-keys';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

describe('事件原子发布', () => {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:16379';
  const prefix = `chat:test:evt:${randomUUID()}`;
  const environment = {
    REDIS_URL: redisUrl,
    EVENT_KEY_PREFIX: prefix,
    EVENT_RETENTION_MS: 86_400_000,
  } as WorkerEnv;
  const redis = new Redis(redisConnectionOptions(redisUrl));
  const publisher = new EventPublisherService(environment);
  const userId = randomUUID();
  const generationId = randomUUID();
  const conversationId = randomUUID();
  const messageId = randomUUID();

  afterAll(async () => {
    const keys = eventKeys(prefix, userId, generationId);
    await redis.del(
      keys.sequence,
      keys.state,
      keys.generationStream,
      keys.userStream,
    );
    await Promise.all([publisher.onApplicationShutdown(), redis.quit()]);
  });

  it('同一次 Lua 执行推进 sequence、快照和两条 Stream', async () => {
    const first = await publisher.publish({
      userId,
      conversationId,
      generationId,
      messageId,
      type: 'message.delta',
      payload: { delta: '甲' },
      state: { content: '甲', reasoningContent: null, status: 'STREAMING' },
    });
    const second = await publisher.publish({
      userId,
      conversationId,
      generationId,
      messageId,
      type: 'message.delta',
      payload: { delta: '乙' },
      state: { content: '甲乙', reasoningContent: null, status: 'STREAMING' },
    });
    const keys = eventKeys(prefix, userId, generationId);
    const [sequence, state, generationEvents, userEvents] = await Promise.all([
      redis.get(keys.sequence),
      redis.get(keys.state),
      redis.xrange(keys.generationStream, '-', '+'),
      redis.xrange(keys.userStream, '-', '+'),
    ]);

    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    expect(sequence).toBe('2');
    expect(JSON.parse(state!)).toMatchObject({ content: '甲乙' });
    expect(generationEvents.map(([id]) => id)).toEqual(['1-0', '2-0']);
    expect(userEvents).toHaveLength(2);
    await expect(redis.pttl(keys.state)).resolves.toBeGreaterThan(0);
    await expect(redis.pttl(keys.generationStream)).resolves.toBeGreaterThan(0);
  });
});
