import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@chat/database';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const enabled = process.env.CHAT_TRACE === '1';
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://chat:chat_local_password@localhost:15432/chat_test?schema=public';
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:16379';
const eventPrefix = process.env.EVENT_KEY_PREFIX ?? 'chat:dev:evt';
const queuePrefix = process.env.GENERATION_QUEUE_PREFIX ?? 'chat:dev:queue';
const outputRoot = path.resolve(
  process.cwd(),
  'artifacts/multi-conversation-trace',
);

test.skip(!enabled, '仅通过 pnpm trace:multi-conversation 显式运行');

test('记录两个真实对话并发、切换与最终收敛的全链路数据', async ({ page }) => {
  expect(new URL(databaseUrl).pathname).toContain('chat_test');
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  const queue = new Queue('generation', {
    connection: { url: redisUrl },
    prefix: queuePrefix,
  });
  const runId = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const outputDirectory = path.join(outputRoot, runId);
  await mkdir(outputDirectory, { recursive: true });

  const sseConnections: Array<{ at: string; url: string }> = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/events') {
      sseConnections.push({ at: new Date().toISOString(), url: request.url() });
    }
  });

  const email = `trace-${crypto.randomUUID()}@example.com`;
  const context: TraceContext = {
    email,
    userId: '',
    conversationIds: [],
    generationIds: [],
    sseConnectionBaseline: 0,
    sseConnections,
    snapshots: [],
  };

  try {
    await register(page, email);
    context.userId = (
      await prisma.user.findUniqueOrThrow({ where: { email } })
    ).id;
    await capture(
      '00-登录并建立用户级SSE',
      page,
      context,
      prisma,
      redis,
      queue,
      outputDirectory,
    );

    const conversationA = await createConversation(page, '链路实验对话 A');
    const conversationB = await createConversation(page, '链路实验对话 B');
    context.conversationIds.push(conversationA, conversationB);
    await page.reload();
    await expect(
      page.locator(`a[href="/chat/${conversationA}"]`),
    ).toBeVisible();
    await expect(
      page.locator(`a[href="/chat/${conversationB}"]`),
    ).toBeVisible();
    context.sseConnectionBaseline = sseConnections.length;
    await capture(
      '01-创建两个空对话',
      page,
      context,
      prisma,
      redis,
      queue,
      outputDirectory,
    );

    await openConversation(page, conversationA, '链路实验对话 A');
    await send(page, '浏览器并发长流式回归 A');
    const generationA = await waitForLatestGeneration(prisma, conversationA);
    context.generationIds.push(generationA);
    await expect(page.getByLabel('正在生成')).toHaveCount(1);
    await waitForSequence(redis, context.userId, generationA, 2);
    await capture(
      '02-A开始流式生成',
      page,
      context,
      prisma,
      redis,
      queue,
      outputDirectory,
    );

    await openConversation(page, conversationB, '链路实验对话 B');
    await capture(
      '03-从A切换到B-A仍在后台生成',
      page,
      context,
      prisma,
      redis,
      queue,
      outputDirectory,
    );
    await send(page, '浏览器并发长流式回归 B');
    const generationB = await waitForLatestGeneration(prisma, conversationB);
    context.generationIds.push(generationB);
    await expect(page.getByLabel('正在生成')).toHaveCount(2);
    await waitForSequence(redis, context.userId, generationB, 2);
    await capture(
      '04-A和B同时流式生成',
      page,
      context,
      prisma,
      redis,
      queue,
      outputDirectory,
    );

    await openConversation(page, conversationA, '链路实验对话 A');
    const answer = page.getByRole('article', { name: '助手回答' }).last();
    const before = (await answer.textContent())?.length ?? 0;
    await expect
      .poll(async () => (await answer.textContent())?.length ?? 0)
      .toBeGreaterThan(before);
    await capture(
      '05-切回A后内容继续增长',
      page,
      context,
      prisma,
      redis,
      queue,
      outputDirectory,
    );

    await expect(page.getByLabel('正在生成')).toHaveCount(0, {
      timeout: 30_000,
    });
    await capture(
      '06-A和B全部完成并收敛',
      page,
      context,
      prisma,
      redis,
      queue,
      outputDirectory,
    );

    expect(sseConnections).toHaveLength(context.sseConnectionBaseline);
    const finalGenerations = await prisma.generation.findMany({
      where: { id: { in: context.generationIds } },
      orderBy: { createdAt: 'asc' },
    });
    expect(finalGenerations).toHaveLength(2);
    expect(finalGenerations.every((item) => item.status === 'COMPLETED')).toBe(
      true,
    );
    await writeTimeline(outputDirectory, context);
  } finally {
    await Promise.allSettled([
      prisma.$disconnect(),
      redis.quit(),
      queue.close(),
    ]);
  }
});

interface TraceContext {
  email: string;
  userId: string;
  conversationIds: string[];
  generationIds: string[];
  sseConnectionBaseline: number;
  sseConnections: Array<{ at: string; url: string }>;
  snapshots: Array<{ stage: string; file: string; summary: string }>;
}

async function capture(
  stage: string,
  page: Page,
  context: TraceContext,
  prisma: PrismaClient,
  redis: Redis,
  queue: Queue,
  outputDirectory: string,
) {
  const generations = await prisma.generation.findMany({
    where: { id: { in: context.generationIds } },
    include: { attempts: true, usageRecords: true },
    orderBy: { createdAt: 'asc' },
  });
  const messages = await prisma.message.findMany({
    where: { conversationId: { in: context.conversationIds } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const conversations = await prisma.conversation.findMany({
    where: { id: { in: context.conversationIds } },
    include: { userStates: { where: { userId: context.userId } } },
    orderBy: { createdAt: 'asc' },
  });
  const outbox = await prisma.outboxEvent.findMany({
    where: { aggregateId: { in: context.generationIds } },
    orderBy: { createdAt: 'asc' },
  });

  const redisGenerations = await Promise.all(
    context.generationIds.map(async (generationId) => {
      const namespace = `${eventPrefix}:{${context.userId}}`;
      const keys = {
        sequence: `${namespace}:gen:${generationId}:seq`,
        state: `${namespace}:gen:${generationId}:state`,
        stream: `${namespace}:gen:${generationId}`,
      };
      const [sequence, state, events, ttl] = await Promise.all([
        redis.get(keys.sequence),
        redis.get(keys.state),
        redis.xrange(keys.stream, '-', '+'),
        redis.pttl(keys.state),
      ]);
      const job = await queue.getJob(generationId);
      return {
        generationId,
        keys,
        sequence: sequence === null ? null : Number(sequence),
        state: state === null ? null : JSON.parse(state),
        generationStream: parseStream(events),
        stateTtlMs: ttl,
        bullMq: job
          ? {
              id: job.id,
              name: job.name,
              state: await job.getState(),
              attemptsMade: job.attemptsMade,
              processedOn: job.processedOn ?? null,
              finishedOn: job.finishedOn ?? null,
            }
          : null,
      };
    }),
  );
  const userStreamKey = `${eventPrefix}:{${context.userId}}:user`;
  const userStream = context.userId
    ? parseStream(await redis.xrange(userStreamKey, '-', '+'))
    : [];
  const browser = await browserSnapshot(page);
  const snapshot = {
    stage,
    capturedAt: new Date().toISOString(),
    identifiers: {
      userId: context.userId,
      conversationIds: context.conversationIds,
      generationIds: context.generationIds,
    },
    browser: { ...browser, sseConnections: context.sseConnections },
    postgres: { conversations, messages, generations, outbox },
    redis: { userStreamKey, userStream, generations: redisGenerations },
  };
  const file = `${stage}.json`;
  await writeFile(
    path.join(outputDirectory, file),
    JSON.stringify(snapshot, bigintReplacer, 2),
    'utf8',
  );
  context.snapshots.push({
    stage,
    file,
    summary: `${generations.map((item) => `${item.id.slice(0, 8)}=${item.status}/seq${item.lastSequence}`).join('，') || '尚无 generation'}；用户流 ${userStream.length} 条；SSE ${context.sseConnections.length} 条`,
  });
}

async function browserSnapshot(page: Page) {
  return page.evaluate(() => ({
    url: window.location.href,
    visibleTitle:
      document.querySelector('.conversation-header h1')?.textContent ?? null,
    activeGenerationDots: document.querySelectorAll('[aria-label="正在生成"]')
      .length,
    visibleAnswers: Array.from(
      document.querySelectorAll('[aria-label="助手回答"]'),
    ).map((element) => ({ textLength: element.textContent?.length ?? 0 })),
  }));
}

function parseStream(rows: Array<[string, string[]]>) {
  return rows.map(([streamId, fields]) => {
    const record: Record<string, unknown> = {};
    for (let index = 0; index < fields.length; index += 2) {
      const key = fields[index]!;
      const value = fields[index + 1] ?? '';
      if (key === 'event') {
        try {
          record[key] = JSON.parse(value);
        } catch {
          record[key] = value;
        }
      } else {
        record[key] = value;
      }
    }
    return { streamId, fields: record };
  });
}

async function writeTimeline(outputDirectory: string, context: TraceContext) {
  const rows = context.snapshots
    .map(
      (item, index) =>
        `| T${index} | ${item.stage} | ${item.summary} | [原始数据](./${encodeURI(item.file)}) |`,
    )
    .join('\n');
  const markdown =
    `# 多对话并发流式链路：本次真实运行记录\n\n` +
    `本报告由 \`pnpm trace:multi-conversation\` 自动生成。模型响应来自测试专用 Fake Provider；浏览器、HTTP、PostgreSQL、Outbox、BullMQ、Worker、Redis 与 SSE 均走真实实现。\n\n` +
    `- 用户 ID：\`${context.userId}\`\n` +
    `- 对话 ID：${context.conversationIds.map((id) => `\`${id}\``).join('、')}\n` +
    `- Generation ID：${context.generationIds.map((id) => `\`${id}\``).join('、')}\n` +
    `- 页面初始化/刷新产生的 SSE 请求总数：${context.sseConnections.length}\n` +
    `- A/B 路由切换阶段新增 SSE 请求数：${context.sseConnections.length - context.sseConnectionBaseline}\n\n` +
    `| 时刻 | 动作 | 状态摘要 | 完整快照 |\n| --- | --- | --- | --- |\n${rows}\n`;
  await writeFile(path.join(outputDirectory, 'timeline.md'), markdown, 'utf8');
  await writeFile(
    path.join(outputRoot, 'LATEST'),
    `${path.basename(outputDirectory)}\n`,
    'utf8',
  );
}

async function register(page: Page, email: string) {
  await page.goto('/login');
  await page.getByRole('tab', { name: '注册' }).click();
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('textbox', { name: /^密码/ }).fill('a-secure-password');
  await page.getByRole('button', { name: '创建账户' }).click();
  await expect(page).toHaveURL(/\/chat$/);
}

async function createConversation(page: Page, title: string) {
  const response = await page.evaluate(async (conversationTitle) => {
    const csrf = document.cookie
      .split('; ')
      .find((entry) => entry.startsWith('chat_csrf='))
      ?.split('=')
      .at(1);
    const result = await fetch('/api/v1/conversations', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        ...(csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {}),
      },
      body: JSON.stringify({ title: conversationTitle }),
    });
    if (!result.ok) throw new Error(`创建对话失败：HTTP ${result.status}`);
    return (await result.json()) as { id: string };
  }, title);
  return response.id;
}

async function openConversation(page: Page, id: string, title: string) {
  await page.locator(`a[href="/chat/${id}"]`).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

async function send(page: Page, content: string) {
  const input = page.getByRole('textbox', { name: '消息内容' });
  await input.fill(content);
  await input.press('Enter');
  await expect(page.getByText(content, { exact: true })).toBeVisible();
}

async function waitForLatestGeneration(
  prisma: PrismaClient,
  conversationId: string,
) {
  let id = '';
  await expect
    .poll(async () => {
      const generation = await prisma.generation.findFirst({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
      });
      id = generation?.id ?? '';
      return id;
    })
    .not.toBe('');
  return id;
}

async function waitForSequence(
  redis: Redis,
  userId: string,
  generationId: string,
  minimum: number,
) {
  const key = `${eventPrefix}:{${userId}}:gen:${generationId}:seq`;
  await expect
    .poll(async () => Number((await redis.get(key)) ?? 0))
    .toBeGreaterThanOrEqual(minimum);
}

function bigintReplacer(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value;
}
