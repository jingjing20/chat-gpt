import {
  authResponseSchema,
  conversationResponseSchema,
  createGenerationResponseSchema,
  csrfResponseSchema,
  generationEventHistorySchema,
} from '@chat/contracts';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { eventKeys } from '../src/events/event-keys';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://chat:chat_local_password@localhost:15432/chat_test?schema=public';
process.env.REDIS_URL = 'redis://localhost:16379';
process.env.ACCESS_TOKEN_SECRET =
  'test-only-access-token-secret-at-least-32-chars';
process.env.AUTH_COOKIE_SECURE = 'false';
process.env.AUTH_RATE_LIMIT_MAX = '100';
process.env.EVENT_KEY_PREFIX = `chat:test:api-events:${process.pid}`;
process.env.OUTBOX_DISPATCH_INTERVAL_MS = '60000';

describe('API 阶段 7 事件恢复（端到端）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;

  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('/chat_test')) {
      throw new Error('E2E 测试只能连接 chat_test 数据库');
    }
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    redis = new Redis(process.env.REDIS_URL!);
  });

  beforeEach(async () => {
    await prisma.outboxEvent.deleteMany();
    await prisma.user.deleteMany();
  });

  it('generation Stream 实际过期后使用 Redis 完整快照恢复', async () => {
    const { agent, generation, csrfToken } = await createGeneration();
    const keys = eventKeys(
      process.env.EVENT_KEY_PREFIX!,
      generation.userId,
      generation.generationId,
    );
    const event = recoveryEvent(generation, 1, '增量');
    await redis
      .multi()
      .xadd(keys.generationStream!, '1-0', 'event', JSON.stringify(event))
      .set(keys.sequence!, '1')
      .set(
        keys.state!,
        JSON.stringify({ content: '完整快照', status: 'STREAMING' }),
      )
      .pexpire(keys.generationStream!, 20)
      .exec();
    await new Promise((resolve) => setTimeout(resolve, 40));

    const response = await agent
      .get(`/api/v1/generations/${generation.generationId}/events`)
      .query({ after_sequence: 0 })
      .expect(200);
    expect(generationEventHistorySchema.parse(response.body)).toEqual({
      mode: 'snapshot',
      snapshot: {
        content: '完整快照',
        reasoningContent: null,
        sequence: 1,
        status: 'STREAMING',
      },
    });
    await agent
      .post(`/api/v1/generations/${generation.generationId}/cancel`)
      .set('x-csrf-token', csrfToken)
      .expect(200);
    await redis.del(keys.state!, keys.sequence!);
  });

  it('Redis 恢复数据全部过期后回退 PostgreSQL checkpoint', async () => {
    const { agent, generation } = await createGeneration();
    await prisma.message.update({
      where: { id: generation.messageId },
      data: { content: '数据库 checkpoint', status: 'STREAMING' },
    });
    await prisma.generation.update({
      where: { id: generation.generationId },
      data: { status: 'STREAMING', lastSequence: 7, checkpointSequence: 7 },
    });

    const response = await agent
      .get(`/api/v1/generations/${generation.generationId}/events`)
      .query({ after_sequence: 2 })
      .expect(200);
    expect(generationEventHistorySchema.parse(response.body)).toEqual({
      mode: 'snapshot',
      snapshot: {
        content: '数据库 checkpoint',
        reasoningContent: null,
        sequence: 7,
        status: 'STREAMING',
      },
    });
  });

  it('连续保留的事件按 sequence 精确补偿且跨用户不可读取', async () => {
    const owner = await createGeneration();
    const stranger = await createGeneration('events-stranger@example.com');
    const keys = eventKeys(
      process.env.EVENT_KEY_PREFIX!,
      owner.generation.userId,
      owner.generation.generationId,
    );
    for (const [sequence, delta] of [
      [1, '甲'],
      [2, '乙'],
    ] as const) {
      const event = recoveryEvent(owner.generation, sequence, delta);
      await redis.xadd(
        keys.generationStream!,
        `${sequence}-0`,
        'event',
        JSON.stringify(event),
      );
    }
    await redis.set(keys.sequence!, '2');

    const response = await owner.agent
      .get(`/api/v1/generations/${owner.generation.generationId}/events`)
      .query({ after_sequence: 0 })
      .expect(200);
    const history = generationEventHistorySchema.parse(response.body);
    expect(history.mode).toBe('events');
    if (history.mode === 'events') {
      expect(history.events.map((event) => event.sequence)).toEqual([1, 2]);
    }
    await stranger.agent
      .get(`/api/v1/generations/${owner.generation.generationId}/events`)
      .expect(404);
    await redis.del(keys.generationStream!, keys.sequence!);
  });

  afterAll(async () => {
    await Promise.all([redis.quit(), app.close()]);
  });

  async function createGeneration(email = 'events-owner@example.com') {
    const agent = request.agent(app.getHttpServer());
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    const initialCsrf = csrfResponseSchema.parse(csrf.body).csrfToken;
    const registered = await agent
      .post('/api/v1/auth/register')
      .set('x-csrf-token', initialCsrf)
      .send({
        email: `${randomUUID()}-${email}`,
        password: 'a-secure-password',
      })
      .expect(201);
    const csrfToken = authResponseSchema.parse(registered.body).csrfToken;
    const conversation = await agent
      .post('/api/v1/conversations')
      .set('x-csrf-token', csrfToken)
      .send({ title: '恢复测试' })
      .expect(201);
    const conversationId = conversationResponseSchema.parse(
      conversation.body,
    ).id;
    const created = await agent
      .post(`/api/v1/conversations/${conversationId}/generations`)
      .set('x-csrf-token', csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({ content: '恢复内容', clientMessageId: randomUUID() })
      .expect(202);
    const parsed = createGenerationResponseSchema.parse(created.body);
    const stored = await prisma.generation.findUniqueOrThrow({
      where: { id: parsed.generation.id },
    });
    return {
      agent,
      csrfToken,
      generation: {
        userId: stored.userId,
        conversationId,
        generationId: stored.id,
        messageId: stored.responseMessageId,
      },
    };
  }
});

function recoveryEvent(
  generation: {
    conversationId: string;
    generationId: string;
    messageId: string;
  },
  sequence: number,
  delta: string,
) {
  return {
    version: 1,
    eventId: randomUUID(),
    type: 'message.delta',
    conversationId: generation.conversationId,
    generationId: generation.generationId,
    messageId: generation.messageId,
    sequence,
    occurredAt: new Date().toISOString(),
    payload: { delta },
  };
}
