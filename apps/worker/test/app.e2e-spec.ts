import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { GenerationWorkerService } from '../src/generation/generation-worker.service';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://chat:chat_local_password@localhost:15432/chat_test?schema=public';
process.env.REDIS_URL = 'redis://localhost:16379';
process.env.GENERATION_QUEUE_PREFIX = `chat:test:worker:${process.pid}`;
process.env.LLM_API_KEY = '';

describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('/chat_test')) {
      throw new Error('E2E 测试只能连接 chat_test 数据库');
    }
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GenerationWorkerService)
      .useValue({})
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health/live (GET)', () => {
    return request(app.getHttpServer())
      .get('/health/live')
      .expect(200)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body).toMatchObject({ status: 'ok', service: 'worker' });
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
