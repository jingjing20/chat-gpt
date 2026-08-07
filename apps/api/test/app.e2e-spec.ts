import type { INestApplication } from '@nestjs/common';
import { authResponseSchema, csrfResponseSchema } from '@chat/contracts';
import { Test, type TestingModule } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import request from 'supertest';
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

describe('API 阶段 1（端到端）', () => {
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
    await prisma.auditLog.deleteMany();
    await prisma.refreshSession.deleteMany();
    await prisma.user.deleteMany();
  });

  it('存活端点可用', async () => {
    await request(app.getHttpServer())
      .get('/health/live')
      .expect(200)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body).toMatchObject({ status: 'ok', service: 'api' });
      });
  });

  it('要求写请求携带匹配的 CSRF 令牌', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'a-secure-password' })
      .expect(403)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body).toMatchObject({ code: 'CSRF_VALIDATION_FAILED' });
        expect(body.requestId).toEqual(expect.any(String));
      });
  });

  it('注册、读取当前用户，且数据库只保存刷新令牌哈希', async () => {
    const agent = request.agent(app.getHttpServer());
    const { csrfToken } = await obtainCsrf(agent);
    const response = await agent
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'User@One.Example', password: 'a-secure-password' })
      .expect(201);

    const responseBody = authResponseSchema.parse(response.body);
    expect(responseBody.user.email).toBe('user@one.example');
    expect(asCookieList(response.headers['set-cookie']).join(';')).toContain(
      'HttpOnly',
    );
    const refreshToken = cookieValue(
      response.headers['set-cookie'],
      'chat_refresh',
    );
    const session = await prisma.refreshSession.findFirstOrThrow();
    expect(session.tokenHash).toBe(
      createHash('sha256').update(refreshToken).digest('hex'),
    );
    expect(session.tokenHash).not.toContain(refreshToken);

    await agent
      .get('/api/v1/auth/me')
      .expect(200)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body).toMatchObject({ email: 'user@one.example' });
      });
  });

  it('刷新时轮换令牌，旧令牌不能再次恢复会话', async () => {
    const agent = request.agent(app.getHttpServer());
    const initialCsrf = await obtainCsrf(agent);
    const registered = await agent
      .post('/api/v1/auth/register')
      .set('x-csrf-token', initialCsrf.csrfToken)
      .send({ email: 'rotate@example.com', password: 'a-secure-password' })
      .expect(201);
    const oldRefresh = cookieValue(
      registered.headers['set-cookie'],
      'chat_refresh',
    );
    const registeredBody = authResponseSchema.parse(registered.body);
    const oldCsrf = registeredBody.csrfToken;

    const refreshed = await agent
      .post('/api/v1/auth/refresh')
      .set('x-csrf-token', oldCsrf)
      .expect(200);
    const newRefresh = cookieValue(
      refreshed.headers['set-cookie'],
      'chat_refresh',
    );
    expect(newRefresh).not.toBe(oldRefresh);

    const sessions = await prisma.refreshSession.findMany({
      orderBy: { createdAt: 'asc' },
    });
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.revokedAt).not.toBeNull();
    expect(sessions[1]?.rotatedFromId).toBe(sessions[0]?.id);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`chat_refresh=${oldRefresh}`, `chat_csrf=${oldCsrf}`])
      .set('x-csrf-token', oldCsrf)
      .expect(401)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body).toMatchObject({ code: 'UNAUTHENTICATED' });
      });
  });

  it('退出撤销刷新会话，且跨用户资源返回不存在', async () => {
    const first = request.agent(app.getHttpServer());
    const second = request.agent(app.getHttpServer());
    const firstCsrf = await obtainCsrf(first);
    const secondCsrf = await obtainCsrf(second);
    const firstRegistration = await first
      .post('/api/v1/auth/register')
      .set('x-csrf-token', firstCsrf.csrfToken)
      .send({ email: 'first@example.com', password: 'a-secure-password' })
      .expect(201);
    const firstRefresh = cookieValue(
      firstRegistration.headers['set-cookie'],
      'chat_refresh',
    );
    const secondRegistration = await second
      .post('/api/v1/auth/register')
      .set('x-csrf-token', secondCsrf.csrfToken)
      .send({ email: 'second@example.com', password: 'a-secure-password' })
      .expect(201);
    const firstBody = authResponseSchema.parse(firstRegistration.body);
    const secondBody = authResponseSchema.parse(secondRegistration.body);

    await first
      .get(`/api/v1/protected-resources/${firstBody.user.id}`)
      .expect(200);
    await first
      .get(`/api/v1/protected-resources/${secondBody.user.id}`)
      .expect(404)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body).toMatchObject({ code: 'NOT_FOUND' });
      });

    const activeCsrf = firstBody.csrfToken;
    await first
      .post('/api/v1/auth/logout')
      .set('x-csrf-token', activeCsrf)
      .expect(204);
    expect(
      await prisma.refreshSession.count({ where: { revokedAt: null } }),
    ).toBe(1);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [
        `chat_refresh=${firstRefresh}`,
        `chat_csrf=${activeCsrf}`,
      ])
      .set('x-csrf-token', activeCsrf)
      .expect(401);

    const loginCsrf = await obtainCsrf(first);
    await first
      .post('/api/v1/auth/login')
      .set('x-csrf-token', loginCsrf.csrfToken)
      .send({ email: 'first@example.com', password: 'a-secure-password' })
      .expect(200)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body).toMatchObject({
          user: { id: firstBody.user.id },
        });
      });
  });

  afterAll(async () => {
    await app.close();
  });
});

async function obtainCsrf(agent: TestAgent): Promise<{
  csrfToken: string;
}> {
  const response = await agent.get('/api/v1/auth/csrf').expect(200);
  return csrfResponseSchema.parse(response.body);
}

function cookieValue(cookies: string | string[], name: string): string {
  const cookie = asCookieList(cookies).find((value) =>
    value.startsWith(`${name}=`),
  );
  if (!cookie) throw new Error(`响应中缺少 ${name} Cookie`);
  return cookie.split(';', 1)[0].slice(name.length + 1);
}

function asCookieList(cookies: string | string[]): string[] {
  return Array.isArray(cookies) ? cookies : [cookies];
}
