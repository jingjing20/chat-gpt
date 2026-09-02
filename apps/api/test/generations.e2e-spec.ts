/** 端到端验证 generation 幂等提交、查询、取消、重试及授权路径。 */

import {
  authResponseSchema,
  conversationResponseSchema,
  createGenerationResponseSchema,
  csrfResponseSchema,
  generationEventHistorySchema,
  generationResponseSchema,
} from '@chat/contracts';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { metrics } from '@chat/observability';
import { OutboxDispatcherService } from '../src/outbox/outbox-dispatcher.service';
import { GENERATION_QUEUE } from '../src/outbox/outbox.constants';
import type { Queue } from 'bullmq';
import type { GenerationJob } from '@chat/contracts';

type TestAgent = ReturnType<typeof request.agent>;

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://chat:chat_local_password@localhost:15432/chat_test?schema=public';
process.env.REDIS_URL = 'redis://localhost:16379';
process.env.ACCESS_TOKEN_SECRET =
  'test-only-access-token-secret-at-least-32-chars';
process.env.AUTH_COOKIE_SECURE = 'false';
process.env.AUTH_RATE_LIMIT_MAX = '100';
process.env.LLM_DEFAULT_MODEL = 'configured-test-model';
process.env.GENERATION_QUEUE_PREFIX = `chat:test:api:${process.pid}`;
process.env.OUTBOX_DISPATCH_INTERVAL_MS = '60000';

describe('API 阶段 4 Generation（端到端）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let dispatcher: OutboxDispatcherService;
  let queue: Queue<GenerationJob>;

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
    dispatcher = app.get(OutboxDispatcherService);
    queue = app.get(GENERATION_QUEUE);
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await prisma.outboxEvent.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversationUserState.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.refreshSession.deleteMany();
    await prisma.user.deleteMany();
  });

  it('事务创建消息、占位消息、generation 和 outbox，并立即返回 202', async () => {
    const agent = request.agent(app.getHttpServer());
    const csrfToken = await register(agent, 'generation@example.com');
    const conversationId = await createConversation(agent, csrfToken);
    const response = await agent
      .post(`/api/v1/conversations/${conversationId}/generations`)
      .set('x-csrf-token', csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({
        content: '解释可靠任务队列',
        model: 'client-must-not-override-config',
        clientMessageId: randomUUID(),
        reasoningEnabled: true,
      })
      .expect(202);
    const body = createGenerationResponseSchema.parse(response.body);
    expect(body.userMessage.status).toBe('COMPLETED');
    expect(body.assistantMessage).toMatchObject({
      status: 'PENDING',
      content: '',
    });
    expect(body.generation.status).toBe('QUEUED');
    expect(body.generation.model).toBe('configured-test-model');
    expect(body.generation).toMatchObject({
      reasoningEnabled: true,
    });
    await expect(
      prisma.generation.findUniqueOrThrow({
        where: { id: body.generation.id },
        select: { reasoningEnabled: true },
      }),
    ).resolves.toEqual({
      reasoningEnabled: true,
    });
    expect(await prisma.generation.count()).toBe(1);
    expect(await prisma.outboxEvent.count()).toBe(1);
  });

  it('新对话和首个 generation 原子创建，网络重试不会留下空对话', async () => {
    const agent = request.agent(app.getHttpServer());
    const csrfToken = await register(agent, 'atomic-first-turn@example.com');
    const idempotencyKey = randomUUID();
    const payload = {
      title: '首问原子创建',
      content: '不要创建孤立的空对话',
      clientMessageId: randomUUID(),
    };
    const create = () =>
      agent
        .post('/api/v1/conversations/with-generation')
        .set('x-csrf-token', csrfToken)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

    const first = createGenerationResponseSchema.parse(
      (await create().expect(202)).body,
    );
    const repeated = createGenerationResponseSchema.parse(
      (await create().expect(202)).body,
    );

    expect(repeated.generation.id).toBe(first.generation.id);
    expect(repeated.conversation.id).toBe(first.conversation.id);
    expect(await prisma.conversation.count()).toBe(1);
    expect(await prisma.message.count()).toBe(2);
    expect(await prisma.generation.count()).toBe(1);
    expect(await prisma.outboxEvent.count()).toBe(1);

    await agent
      .post('/api/v1/conversations/with-generation')
      .set('x-csrf-token', csrfToken)
      .set('Idempotency-Key', idempotencyKey)
      .send({ ...payload, content: '同一幂等键不能换请求' })
      .expect(409);
    expect(await prisma.conversation.count()).toBe(1);
  });

  it('相同幂等键和请求返回原资源，不同请求返回冲突', async () => {
    const agent = request.agent(app.getHttpServer());
    const csrfToken = await register(agent, 'idempotency@example.com');
    const conversationId = await createConversation(agent, csrfToken);
    const idempotencyKey = randomUUID();
    const payload = {
      content: '只创建一次',
      clientMessageId: randomUUID(),
    };
    const first = await agent
      .post(`/api/v1/conversations/${conversationId}/generations`)
      .set('x-csrf-token', csrfToken)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(202);
    const repeated = await agent
      .post(`/api/v1/conversations/${conversationId}/generations`)
      .set('x-csrf-token', csrfToken)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(202);
    expect(
      createGenerationResponseSchema.parse(repeated.body).generation.id,
    ).toBe(createGenerationResponseSchema.parse(first.body).generation.id);
    expect(await prisma.generation.count()).toBe(1);
    expect(await prisma.message.count()).toBe(2);

    await agent
      .post(`/api/v1/conversations/${conversationId}/generations`)
      .set('x-csrf-token', csrfToken)
      .set('Idempotency-Key', idempotencyKey)
      .send({ ...payload, content: '不同请求' })
      .expect(409)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      });
  });

  it('Outbox 可重复投递且固定 Job ID 去重', async () => {
    const agent = request.agent(app.getHttpServer());
    const csrfToken = await register(agent, 'outbox@example.com');
    const conversationId = await createConversation(agent, csrfToken);
    const created = await agent
      .post(`/api/v1/conversations/${conversationId}/generations`)
      .set('x-csrf-token', csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({
        content: '可靠投递',
        clientMessageId: randomUUID(),
      })
      .expect(202);
    const generationId = createGenerationResponseSchema.parse(created.body)
      .generation.id;
    await prisma.outboxEvent.updateMany({ data: { publishedAt: null } });
    await dispatcher.dispatchOnce();
    await prisma.outboxEvent.updateMany({ data: { publishedAt: null } });
    await dispatcher.dispatchOnce();

    expect(await prisma.outboxEvent.count()).toBe(1);
    expect(
      await prisma.outboxEvent
        .findFirstOrThrow()
        .then((event) => event.publishedAt),
    ).not.toBeNull();
    await expect(queue.getJob(generationId)).resolves.toMatchObject({
      id: generationId,
      data: { generationId },
    });
    expect(metrics.render()).toContain('chat_outbox_unpublished_count');
  });

  it('终态 Outbox 可重投且只生成一个稳定终态事件', async () => {
    const agent = request.agent(app.getHttpServer());
    const csrfToken = await register(agent, 'terminal-outbox@example.com');
    const conversationId = await createConversation(agent, csrfToken);
    const created = createGenerationResponseSchema.parse(
      (
        await agent
          .post(`/api/v1/conversations/${conversationId}/generations`)
          .set('x-csrf-token', csrfToken)
          .set('Idempotency-Key', randomUUID())
          .send({ content: '可靠终态', clientMessageId: randomUUID() })
          .expect(202)
      ).body,
    );
    const generation = await prisma.generation.findUniqueOrThrow({
      where: { id: created.generation.id },
    });
    await prisma.$transaction([
      prisma.message.update({
        where: { id: generation.responseMessageId },
        data: {
          status: 'COMPLETED',
          content: '最终内容',
          completedAt: new Date(),
        },
      }),
      prisma.generation.update({
        where: { id: generation.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      }),
      prisma.outboxEvent.create({
        data: {
          aggregateType: 'generation',
          aggregateId: generation.id,
          type: 'generation.completed',
          payload: {
            version: 1,
            userId: generation.userId,
            conversationId: generation.conversationId,
            generationId: generation.id,
            messageId: generation.responseMessageId,
            type: 'generation.completed',
            payload: { finishReason: 'stop' },
            state: {
              content: '最终内容',
              reasoningContent: null,
              status: 'COMPLETED',
            },
          },
        },
      }),
    ]);

    await dispatcher.dispatchOnce();
    const terminal = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId: generation.id, type: 'generation.completed' },
    });
    await prisma.outboxEvent.update({
      where: { id: terminal.id },
      data: { publishedAt: null },
    });
    await dispatcher.dispatchOnce();

    const history = generationEventHistorySchema.parse(
      (
        await agent
          .get(`/api/v1/generations/${generation.id}/events`)
          .query({ after_sequence: 0 })
          .expect(200)
      ).body,
    );
    expect(history.mode).toBe('events');
    if (history.mode === 'events') {
      expect(history.events).toHaveLength(1);
      expect(history.events[0]).toMatchObject({
        eventId: terminal.id,
        type: 'generation.completed',
        payload: { finishReason: 'stop' },
      });
    }
  });

  it('查询和取消按用户隔离，重复取消保持幂等', async () => {
    const owner = request.agent(app.getHttpServer());
    const stranger = request.agent(app.getHttpServer());
    const ownerCsrf = await register(owner, 'generation-owner@example.com');
    const strangerCsrf = await register(
      stranger,
      'generation-stranger@example.com',
    );
    const conversationId = await createConversation(owner, ownerCsrf);
    const created = await owner
      .post(`/api/v1/conversations/${conversationId}/generations`)
      .set('x-csrf-token', ownerCsrf)
      .set('Idempotency-Key', randomUUID())
      .send({
        content: '稍后取消',
        clientMessageId: randomUUID(),
      })
      .expect(202);
    const generationId = createGenerationResponseSchema.parse(created.body)
      .generation.id;

    await stranger.get(`/api/v1/generations/${generationId}`).expect(404);
    await stranger
      .post(`/api/v1/generations/${generationId}/cancel`)
      .set('x-csrf-token', strangerCsrf)
      .expect(404);
    for (let index = 0; index < 2; index += 1) {
      const response = await owner
        .post(`/api/v1/generations/${generationId}/cancel`)
        .set('x-csrf-token', ownerCsrf)
        .expect(200);
      expect(generationResponseSchema.parse(response.body).status).toBe(
        'CANCEL_REQUESTED',
      );
    }
  });

  it('按用户限制并发 generation，终态后释放额度', async () => {
    const agent = request.agent(app.getHttpServer());
    const csrfToken = await register(agent, 'concurrency@example.com');
    const conversationA = await createConversation(agent, csrfToken);
    const conversationB = await createConversation(agent, csrfToken);

    const create = (conversationId: string, content: string) =>
      agent
        .post(`/api/v1/conversations/${conversationId}/generations`)
        .set('x-csrf-token', csrfToken)
        .set('Idempotency-Key', randomUUID())
        .send({
          content,
          clientMessageId: randomUUID(),
        });

    const first = await create(conversationA, '任务 A').expect(202);
    await create(conversationB, '任务 B').expect(202);
    await create(conversationA, '超出并发')
      .expect(429)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body).toMatchObject({
          code: 'USER_CONCURRENCY_LIMIT',
          message: '同时最多运行 2 个生成任务',
        });
      });

    const firstId = createGenerationResponseSchema.parse(first.body).generation
      .id;
    await prisma.generation.update({
      where: { id: firstId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await create(conversationA, '释放额度后创建').expect(202);
    expect(await prisma.generation.count()).toBe(3);
  });

  it('失败任务可幂等重试并关联旧消息，跨用户和非失败任务不可重试', async () => {
    const owner = request.agent(app.getHttpServer());
    const stranger = request.agent(app.getHttpServer());
    const ownerCsrf = await register(owner, 'retry-owner@example.com');
    const strangerCsrf = await register(stranger, 'retry-stranger@example.com');
    const conversationId = await createConversation(owner, ownerCsrf);
    const created = await owner
      .post(`/api/v1/conversations/${conversationId}/generations`)
      .set('x-csrf-token', ownerCsrf)
      .set('Idempotency-Key', randomUUID())
      .send({
        content: '请重试这个问题',
        clientMessageId: randomUUID(),
        reasoningEnabled: true,
      })
      .expect(202);
    const source = createGenerationResponseSchema.parse(created.body);

    await owner
      .post(`/api/v1/generations/${source.generation.id}/retry`)
      .set('x-csrf-token', ownerCsrf)
      .set('Idempotency-Key', randomUUID())
      .expect(409)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body.code).toBe('GENERATION_NOT_RETRYABLE');
      });
    await prisma.generation.update({
      where: { id: source.generation.id },
      data: { status: 'FAILED', completedAt: new Date() },
    });
    await prisma.message.update({
      where: { id: source.assistantMessage.id },
      data: { status: 'FAILED', content: '部分回答' },
    });

    await stranger
      .post(`/api/v1/generations/${source.generation.id}/retry`)
      .set('x-csrf-token', strangerCsrf)
      .set('Idempotency-Key', randomUUID())
      .expect(404);

    const retryKey = randomUUID();
    const retry = () =>
      owner
        .post(`/api/v1/generations/${source.generation.id}/retry`)
        .set('x-csrf-token', ownerCsrf)
        .set('Idempotency-Key', retryKey);
    const first = createGenerationResponseSchema.parse(
      (await retry().expect(202)).body,
    );
    const repeated = createGenerationResponseSchema.parse(
      (await retry().expect(202)).body,
    );
    expect(repeated.generation.id).toBe(first.generation.id);
    expect(first.userMessage.content).toBe('请重试这个问题');
    expect(first.generation.reasoningEnabled).toBe(true);
    const messages = await prisma.message.findMany({
      where: { id: { in: [first.userMessage.id, first.assistantMessage.id] } },
    });
    expect(
      messages.find((message) => message.id === first.userMessage.id)
        ?.parentMessageId,
    ).toBe(source.userMessage.id);
    expect(
      messages.find((message) => message.id === first.assistantMessage.id)
        ?.parentMessageId,
    ).toBe(source.assistantMessage.id);
    expect(await prisma.generation.count()).toBe(2);
    expect(await prisma.outboxEvent.count()).toBe(2);
  });

  afterAll(async () => {
    await app.close();
  });
});

async function register(agent: TestAgent, email: string): Promise<string> {
  const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
  const { csrfToken } = csrfResponseSchema.parse(csrf.body);
  const response = await agent
    .post('/api/v1/auth/register')
    .set('x-csrf-token', csrfToken)
    .send({ email, password: 'a-secure-password' })
    .expect(201);
  return authResponseSchema.parse(response.body).csrfToken;
}

async function createConversation(
  agent: TestAgent,
  csrfToken: string,
): Promise<string> {
  const response = await agent
    .post('/api/v1/conversations')
    .set('x-csrf-token', csrfToken)
    .send({ title: '阶段 4 测试' })
    .expect(201);
  return conversationResponseSchema.parse(response.body).id;
}
