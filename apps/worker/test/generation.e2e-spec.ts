import { readWorkerEnv, redisConnectionOptions } from '@chat/config';
import {
  GenerationStatus,
  MessageRole,
  MessageStatus,
  type PrismaClient,
} from '@chat/database';
import { FakeLlmProvider } from '@chat/test-utils';
import { randomUUID } from 'node:crypto';
import { GenerationProcessor } from '../src/generation/generation.processor';
import { PrismaService } from '../src/database/prisma.service';
import { GenerationWorkerService } from '../src/generation/generation-worker.service';
import { Queue } from 'bullmq';
import { GENERATION_QUEUE_NAME } from '../src/generation/generation.constants';
import type { GenerationJob } from '@chat/contracts';
import { GenerationReliabilityService } from '../src/generation/generation-reliability.service';
import { ZombieGenerationMonitorService } from '../src/generation/zombie-generation-monitor.service';
import { metrics } from '@chat/observability';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://chat:chat_local_password@localhost:15432/chat_test?schema=public';
process.env.REDIS_URL = 'redis://localhost:16379';
process.env.GENERATION_RETRY_BASE_DELAY_MS = '1';
process.env.GENERATION_CANCEL_POLL_MS = '25';
process.env.GENERATION_QUEUE_PREFIX = `chat:test:worker-generation:${process.pid}`;

describe('Worker 阶段 4 Generation 状态机（集成）', () => {
  const prisma = new PrismaService();
  const environment = readWorkerEnv(process.env);
  const queue = new Queue<GenerationJob>(GENERATION_QUEUE_NAME, {
    connection: redisConnectionOptions(environment.REDIS_URL),
    prefix: environment.GENERATION_QUEUE_PREFIX,
  });

  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('/chat_test')) {
      throw new Error('E2E 测试只能连接 chat_test 数据库');
    }
    await prisma.$connect();
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await prisma.outboxEvent.deleteMany();
    await prisma.user.deleteMany();
  });

  it('首 delta 前可重试，最终持久化完整正文、reasoning 和 usage', async () => {
    const generationId = await seedGeneration(prisma);
    const provider = FakeLlmProvider.attempts([
      [{ error: 'RATE_LIMITED', retryableBeforeFirstDelta: true }],
      [
        { event: { type: 'reasoning_delta', delta: '先分析' } },
        { event: { type: 'content_delta', delta: '最终回答' } },
        {
          event: {
            type: 'usage',
            usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
          },
        },
        {
          event: {
            type: 'finish',
            finishReason: 'stop',
            providerRequestId: 'fake-request-1',
          },
        },
      ],
    ]);
    await new GenerationProcessor(prisma, provider, environment).process(
      generationId,
    );

    const generation = await prisma.generation.findUniqueOrThrow({
      where: { id: generationId },
      include: { responseMessage: true, attempts: true, usageRecords: true },
    });
    expect(generation.status).toBe(GenerationStatus.COMPLETED);
    expect(generation.responseMessage).toMatchObject({
      status: MessageStatus.COMPLETED,
      content: '最终回答',
      reasoningContent: '先分析',
    });
    expect(generation.attempts).toHaveLength(2);
    expect(generation.attempts.map((attempt) => attempt.status)).toEqual([
      'FAILED',
      'COMPLETED',
    ]);
    expect(generation.usageRecords[0]).toMatchObject({ totalTokens: 12 });
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]?.userId).not.toContain('@');
  });

  it('首 delta 后断连不重试，保留部分内容并标记失败', async () => {
    const generationId = await seedGeneration(prisma);
    const provider = new FakeLlmProvider([
      { event: { type: 'content_delta', delta: '已收到的部分' } },
      { error: 'CONNECTION_LOST', retryableBeforeFirstDelta: false },
    ]);
    await new GenerationProcessor(prisma, provider, environment).process(
      generationId,
    );

    const generation = await prisma.generation.findUniqueOrThrow({
      where: { id: generationId },
      include: { responseMessage: true, attempts: true },
    });
    expect(generation.status).toBe(GenerationStatus.FAILED);
    expect(generation.errorCode).toBe('CONNECTION_LOST');
    expect(generation.responseMessage).toMatchObject({
      status: MessageStatus.FAILED,
      content: '已收到的部分',
    });
    expect(generation.attempts).toHaveLength(1);
    expect(generation.attempts[0]?.receivedFirstDelta).toBe(true);
    expect(provider.requests).toHaveLength(1);
    expect(metrics.render()).toContain(
      'chat_generation_provider_errors_total{code="CONNECTION_LOST",provider="fake"}',
    );
  });

  it('供应商认证失败不重试并产生单次高优指标', async () => {
    const generationId = await seedGeneration(prisma);
    const provider = new FakeLlmProvider([
      { error: 'AUTHENTICATION_FAILED', retryableBeforeFirstDelta: false },
    ]);
    await new GenerationProcessor(prisma, provider, environment).process(
      generationId,
    );

    const generation = await prisma.generation.findUniqueOrThrow({
      where: { id: generationId },
      include: { attempts: true },
    });
    expect(generation).toMatchObject({
      status: GenerationStatus.FAILED,
      errorCode: 'AUTHENTICATION_FAILED',
    });
    expect(generation.attempts).toHaveLength(1);
    expect(provider.requests).toHaveLength(1);
    expect(metrics.render()).toContain(
      'chat_generation_provider_errors_total{code="AUTHENTICATION_FAILED",provider="fake"}',
    );
  });

  it('流式生成期间按版本写入 PostgreSQL checkpoint', async () => {
    const generationId = await seedGeneration(prisma);
    const checkpointContent = '检'.repeat(400);
    const provider = new FakeLlmProvider([
      { event: { type: 'content_delta', delta: checkpointContent } },
      {
        event: { type: 'finish', finishReason: 'stop' },
        delayMs: 500,
      },
    ]);
    const processorEnvironment = {
      ...environment,
      GENERATION_CHECKPOINT_MAX_CHARS: 256,
    };
    const processing = new GenerationProcessor(
      prisma,
      provider,
      processorEnvironment,
    ).process(generationId);

    await waitFor(async () => {
      const generation = await prisma.generation.findUniqueOrThrow({
        where: { id: generationId },
        include: { responseMessage: true },
      });
      return (
        generation.status === GenerationStatus.STREAMING &&
        generation.checkpointSequence > 0 &&
        generation.responseMessage.content === checkpointContent
      );
    });
    await processing;
  });

  it('取消标记会 Abort 上游并持久化 CANCELLED 终态', async () => {
    const generationId = await seedGeneration(prisma);
    const provider = FakeLlmProvider.text('不会完整返回', 1000);
    const processing = new GenerationProcessor(
      prisma,
      provider,
      environment,
    ).process(generationId);
    await waitFor(async () => {
      const attemptCount = await prisma.generationAttempt.count({
        where: { generationId },
      });
      return attemptCount === 1 && provider.requests.length === 1;
    });
    await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: GenerationStatus.CANCEL_REQUESTED,
        cancelRequestedAt: new Date(),
      },
    });
    await processing;

    const generation = await prisma.generation.findUniqueOrThrow({
      where: { id: generationId },
      include: { responseMessage: true, attempts: true },
    });
    expect(generation.status).toBe(GenerationStatus.CANCELLED);
    expect(generation.responseMessage.status).toBe(MessageStatus.CANCELLED);
    expect(generation.attempts[0]?.status).toBe('CANCELLED');
  });

  it('BullMQ 后台 Worker 在请求生命周期外完成 generation', async () => {
    const generationId = await seedGeneration(prisma);
    const processor = new GenerationProcessor(
      prisma,
      FakeLlmProvider.text('后台完成'),
      environment,
    );
    const worker = new GenerationWorkerService(processor, environment);
    worker.onApplicationBootstrap();
    try {
      await queue.add('generate', { generationId }, { jobId: generationId });
      await waitFor(async () => {
        const generation = await prisma.generation.findUniqueOrThrow({
          where: { id: generationId },
        });
        return generation.status === GenerationStatus.COMPLETED;
      });
      const message = await prisma.message.findFirstOrThrow({
        where: { responseGeneration: { id: generationId } },
      });
      expect(message.content).toBe('后台完成');
      const userState = await prisma.conversationUserState.findFirstOrThrow({
        where: { conversationId: message.conversationId },
      });
      expect(userState.hasUnread).toBe(true);
    } finally {
      await worker.onApplicationShutdown();
    }
  });

  it('两个 Processor 竞争同一 generation 时只有一个 Writer 和一个终态', async () => {
    const generationId = await seedGeneration(prisma);
    const provider = FakeLlmProvider.text('唯一回答', 5);
    const first = new GenerationProcessor(prisma, provider, environment);
    const second = new GenerationProcessor(prisma, provider, environment);

    await Promise.all([
      first.process(generationId),
      second.process(generationId),
    ]);

    const generation = await prisma.generation.findUniqueOrThrow({
      where: { id: generationId },
      include: { attempts: true, usageRecords: true, responseMessage: true },
    });
    expect(generation.status).toBe(GenerationStatus.COMPLETED);
    expect(generation.responseMessage.content).toBe('唯一回答');
    expect(generation.attempts).toHaveLength(1);
    expect(provider.requests).toHaveLength(1);
  });

  it('分层并发许可在释放后可再次获取，不泄漏资源', async () => {
    const reliability = new GenerationReliabilityService({
      ...environment,
      GENERATION_GLOBAL_CONCURRENCY: 1,
      GENERATION_PROVIDER_CONCURRENCY: 1,
      GENERATION_USER_CONCURRENCY: 1,
      GENERATION_SEMAPHORE_WAIT_MS: 0,
    });
    const input = {
      generationId: randomUUID(),
      userId: randomUUID(),
      provider: 'fake',
      token: randomUUID(),
    };
    try {
      const first = await reliability.acquire(input);
      expect(first).not.toBeNull();
      expect(
        await reliability.acquire({ ...input, token: randomUUID() }),
      ).toBeNull();
      await reliability.release(first!);
      const second = await reliability.acquire({
        ...input,
        token: randomUUID(),
      });
      expect(second).not.toBeNull();
      await reliability.release(second!);
    } finally {
      await reliability.onApplicationShutdown();
    }
  });

  it('僵尸检查仅在 BullMQ Job 不活跃时保留 partial 并终结 attempt', async () => {
    const generationId = await seedGeneration(prisma);
    const writerToken = randomUUID();
    const generation = await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: GenerationStatus.STREAMING,
        writerToken,
        writerHeartbeatAt: new Date(Date.now() - 60_000),
      },
    });
    await prisma.message.update({
      where: { id: generation.responseMessageId },
      data: { status: MessageStatus.STREAMING, content: '已保存的 partial' },
    });
    await prisma.generationAttempt.create({
      data: { generationId, attemptNo: 1, writerToken },
    });
    const monitor = new ZombieGenerationMonitorService(prisma, {
      ...environment,
      GENERATION_HEARTBEAT_TIMEOUT_MS: 1_000,
    });
    try {
      expect(await monitor.checkOnce()).toBe(1);
      const recovered = await prisma.generation.findUniqueOrThrow({
        where: { id: generationId },
        include: { responseMessage: true, attempts: true },
      });
      expect(recovered).toMatchObject({
        status: GenerationStatus.FAILED,
        errorCode: 'WORKER_LOST',
      });
      expect(recovered.responseMessage).toMatchObject({
        status: MessageStatus.FAILED,
        content: '已保存的 partial',
      });
      expect(recovered.attempts[0]).toMatchObject({
        status: 'FAILED',
        errorCode: 'WORKER_LOST',
      });
    } finally {
      await monitor.onApplicationShutdown();
    }
  });

  afterAll(async () => {
    await queue.close();
    await prisma.$disconnect();
  });
});

async function seedGeneration(prisma: PrismaClient): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `${randomUUID()}@example.com`,
      passwordHash: '测试中不用于认证',
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      ownerUserId: user.id,
      title: 'Worker 测试',
      userStates: { create: { userId: user.id } },
    },
  });
  const requestMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      authorUserId: user.id,
      role: MessageRole.USER,
      status: MessageStatus.COMPLETED,
      content: '请生成测试回答',
      completedAt: new Date(),
    },
  });
  const responseMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: MessageRole.ASSISTANT,
      status: MessageStatus.PENDING,
      content: '',
    },
  });
  const generation = await prisma.generation.create({
    data: {
      userId: user.id,
      conversationId: conversation.id,
      requestMessageId: requestMessage.id,
      responseMessageId: responseMessage.id,
      provider: 'fake',
      model: 'fake-model',
      idempotencyKey: randomUUID(),
      requestHash: 'a'.repeat(64),
    },
  });
  return generation.id;
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('等待状态转换超时');
}
