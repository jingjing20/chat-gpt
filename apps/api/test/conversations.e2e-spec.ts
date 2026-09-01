/** 端到端验证对话生命周期、消息分页、归档恢复及用户数据隔离。 */

import type { INestApplication } from '@nestjs/common';
import {
  authResponseSchema,
  conversationListResponseSchema,
  conversationResponseSchema,
  csrfResponseSchema,
  messagePageResponseSchema,
} from '@chat/contracts';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';

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
process.env.GENERATION_QUEUE_PREFIX = `chat:test:api:${process.pid}`;

describe('API 阶段 2 对话与消息（端到端）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

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
  });

  beforeEach(async () => {
    await prisma.outboxEvent.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversationUserState.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.refreshSession.deleteMany();
    await prisma.user.deleteMany();
  });

  it('创建、读取、重命名、标记已读、归档和恢复对话', async () => {
    const agent = request.agent(app.getHttpServer());
    const csrfToken = await register(agent, 'crud@example.com');

    const created = await agent
      .post('/api/v1/conversations')
      .set('x-csrf-token', csrfToken)
      .send({ title: '第一段对话' })
      .expect(201);
    const conversationId = conversationResponseSchema.parse(created.body).id;

    await agent
      .get('/api/v1/conversations')
      .expect(200)
      .expect(({ body }: { body: { items: Array<{ id: string }> } }) => {
        expect(body.items.map((item) => item.id)).toEqual([conversationId]);
      });
    await agent
      .get(`/api/v1/conversations/${conversationId}`)
      .expect(200)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body).toMatchObject({ id: conversationId, title: '第一段对话' });
      });

    await agent
      .patch(`/api/v1/conversations/${conversationId}`)
      .set('x-csrf-token', csrfToken)
      .send({ title: '重命名后的对话' })
      .expect(200)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body).toMatchObject({ title: '重命名后的对话' });
      });
    await agent
      .post(`/api/v1/conversations/${conversationId}/read`)
      .set('x-csrf-token', csrfToken)
      .expect(200)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body.lastReadAt).toEqual(expect.any(String));
      });
    await agent
      .post(`/api/v1/conversations/${conversationId}/archive`)
      .set('x-csrf-token', csrfToken)
      .expect(200);

    await agent
      .get('/api/v1/conversations')
      .expect(200)
      .expect(({ body }: { body: { items: unknown[] } }) => {
        expect(body.items).toEqual([]);
      });
    await agent
      .get('/api/v1/conversations?archived=true')
      .expect(200)
      .expect(({ body }: { body: { items: Array<{ id: string }> } }) => {
        expect(body.items.map((item) => item.id)).toEqual([conversationId]);
      });

    await agent
      .post(`/api/v1/conversations/${conversationId}/restore`)
      .set('x-csrf-token', csrfToken)
      .expect(200)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body.archivedAt).toBeNull();
      });
    await agent
      .get('/api/v1/conversations')
      .expect(200)
      .expect(({ body }: { body: { items: Array<{ id: string }> } }) => {
        expect(body.items.map((item) => item.id)).toEqual([conversationId]);
      });
  });

  it('对话列表使用稳定游标分页且没有重复或遗漏', async () => {
    const agent = request.agent(app.getHttpServer());
    const csrfToken = await register(agent, 'conversation-pages@example.com');
    for (const title of ['第一页', '第二页', '第三页']) {
      await agent
        .post('/api/v1/conversations')
        .set('x-csrf-token', csrfToken)
        .send({ title })
        .expect(201);
    }
    const first = conversationListResponseSchema.parse(
      (await agent.get('/api/v1/conversations').query({ limit: 2 }).expect(200))
        .body,
    );
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = conversationListResponseSchema.parse(
      (
        await agent
          .get('/api/v1/conversations')
          .query({ limit: 2, cursor: first.nextCursor })
          .expect(200)
      ).body,
    );
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(3);
  });

  it('只能永久删除已归档且没有活动生成任务的本人对话', async () => {
    const owner = request.agent(app.getHttpServer());
    const stranger = request.agent(app.getHttpServer());
    const ownerCsrf = await register(owner, 'delete-owner@example.com');
    const strangerCsrf = await register(
      stranger,
      'delete-stranger@example.com',
    );
    const created = await owner
      .post('/api/v1/conversations')
      .set('x-csrf-token', ownerCsrf)
      .send({ title: '待永久删除' })
      .expect(201);
    const conversationId = conversationResponseSchema.parse(created.body).id;

    await owner
      .delete(`/api/v1/conversations/${conversationId}`)
      .set('x-csrf-token', ownerCsrf)
      .expect(409)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body.code).toBe('CONVERSATION_NOT_ARCHIVED');
      });
    await stranger
      .delete(`/api/v1/conversations/${conversationId}`)
      .set('x-csrf-token', strangerCsrf)
      .expect(404);

    await owner
      .post(`/api/v1/conversations/${conversationId}/generations`)
      .set('x-csrf-token', ownerCsrf)
      .set('Idempotency-Key', randomUUID())
      .send({ content: '仍在生成', clientMessageId: randomUUID() })
      .expect(202);
    await owner
      .post(`/api/v1/conversations/${conversationId}/archive`)
      .set('x-csrf-token', ownerCsrf)
      .expect(200);
    await owner
      .delete(`/api/v1/conversations/${conversationId}`)
      .set('x-csrf-token', ownerCsrf)
      .expect(409)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body.code).toBe('CONVERSATION_HAS_ACTIVE_GENERATION');
      });

    await prisma.generation.updateMany({
      where: { conversationId },
      data: { status: 'CANCELLED' },
    });
    await owner
      .delete(`/api/v1/conversations/${conversationId}`)
      .set('x-csrf-token', ownerCsrf)
      .expect(204);
    expect(
      await prisma.conversation.count({ where: { id: conversationId } }),
    ).toBe(0);
    expect(await prisma.message.count({ where: { conversationId } })).toBe(0);
    expect(await prisma.generation.count({ where: { conversationId } })).toBe(
      0,
    );
    expect(await prisma.outboxEvent.count()).toBe(0);
    expect(
      await prisma.auditLog.findFirst({
        where: { action: 'CONVERSATION_DELETED', subjectId: conversationId },
      }),
    ).toMatchObject({ outcome: 'SUCCEEDED' });
  });

  it('消息游标分页没有重复或遗漏，并持久化静态 assistant 消息', async () => {
    const agent = request.agent(app.getHttpServer());
    const csrfToken = await register(agent, 'pagination@example.com');
    const created = await agent
      .post('/api/v1/conversations')
      .set('x-csrf-token', csrfToken)
      .send({ title: '分页验证' })
      .expect(201);
    const conversationId = conversationResponseSchema.parse(created.body).id;

    for (let index = 0; index < 13; index += 1) {
      await agent
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set('x-csrf-token', csrfToken)
        .send({ content: `消息 ${index}` })
        .expect(201);
    }

    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await agent
        .get(`/api/v1/conversations/${conversationId}/messages`)
        .query({ limit: 7, ...(cursor ? { cursor } : {}) })
        .expect(200);
      const page = messagePageResponseSchema.parse(response.body);
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(ids).toHaveLength(26);
    expect(new Set(ids).size).toBe(26);
    expect(await prisma.message.count()).toBe(26);
  });

  it('两个用户无法读取或修改彼此的对话、消息和滚动位置', async () => {
    const owner = request.agent(app.getHttpServer());
    const stranger = request.agent(app.getHttpServer());
    const ownerCsrf = await register(owner, 'owner@example.com');
    const strangerCsrf = await register(stranger, 'stranger@example.com');
    const created = await owner
      .post('/api/v1/conversations')
      .set('x-csrf-token', ownerCsrf)
      .send({ title: '私有对话' })
      .expect(201);
    const conversationId = conversationResponseSchema.parse(created.body).id;

    await stranger.get(`/api/v1/conversations/${conversationId}`).expect(404);
    await stranger
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .expect(404);
    await stranger
      .patch(`/api/v1/conversations/${conversationId}`)
      .set('x-csrf-token', strangerCsrf)
      .send({ title: '越权修改' })
      .expect(404);
    await stranger
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('x-csrf-token', strangerCsrf)
      .send({ content: '越权消息' })
      .expect(404);
    await stranger
      .put(`/api/v1/conversations/${conversationId}/scroll-position`)
      .set('x-csrf-token', strangerCsrf)
      .send({ scrollOffset: 800 })
      .expect(404);
    await stranger
      .post(`/api/v1/conversations/${conversationId}/restore`)
      .set('x-csrf-token', strangerCsrf)
      .expect(404);
  });

  it('保存并读取对话级滚动位置', async () => {
    const agent = request.agent(app.getHttpServer());
    const csrfToken = await register(agent, 'scroll@example.com');
    const created = await agent
      .post('/api/v1/conversations')
      .set('x-csrf-token', csrfToken)
      .send({ title: '滚动位置' })
      .expect(201);
    const conversationId = conversationResponseSchema.parse(created.body).id;

    await agent
      .put(`/api/v1/conversations/${conversationId}/scroll-position`)
      .set('x-csrf-token', csrfToken)
      .send({ scrollOffset: 1234 })
      .expect(200);
    await agent
      .get(`/api/v1/conversations/${conversationId}`)
      .expect(200)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body).toMatchObject({ scrollOffset: 1234 });
      });
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
