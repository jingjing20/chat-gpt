import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';

const raceIterations = Number(process.env.PHASE_6_RACE_ITERATIONS ?? 20);

test('流式自动跟随不保存滚动位置，用户主动滚动才保存', async ({ page }) => {
  const scrollPositionRequests: number[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/scroll-position')) {
      scrollPositionRequests.push(Date.now());
    }
  });

  await register(page);
  await createNamedConversation(page, '滚动位置写入回归');
  await expect(page.getByText('生成中…')).toHaveCount(0, { timeout: 5000 });
  scrollPositionRequests.length = 0;

  await send(page, '浏览器长流式回归 A');
  await expect(page.getByText('生成中…')).toHaveCount(0, { timeout: 5000 });
  expect(scrollPositionRequests).toHaveLength(0);

  const viewport = page.locator('.message-viewport');
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    )
    .toBe(true);
  const expectedScrollOffset = await viewport.evaluate((element) => {
    const scrollOffset = Math.round(
      (element.scrollHeight - element.clientHeight) / 2,
    );
    element.scrollTop = scrollOffset;
    element.dispatchEvent(new Event('scroll'));
    return Math.round(element.scrollTop);
  });
  await expect.poll(() => scrollPositionRequests.length).toBe(1);

  await page.getByRole('button', { name: '新建对话' }).click();
  await page.getByRole('link', { name: /滚动位置写入回归/ }).click();
  await waitForConversation(page, '滚动位置写入回归');
  await expect
    .poll(() => viewport.evaluate((element) => Math.round(element.scrollTop)))
    .toBe(expectedScrollOffset);

  await page.getByRole('button', { name: '新建对话' }).click();
  await page.getByRole('link', { name: /滚动位置写入回归/ }).click();
  await waitForConversation(page, '滚动位置写入回归');
  await expect
    .poll(() => viewport.evaluate((element) => Math.round(element.scrollTop)))
    .toBe(expectedScrollOffset);
});

test('切回并发对话后正文继续流式增长且状态圆点保留', async ({ page }) => {
  await register(page);
  const conversationA = await createNamedConversation(
    page,
    '这是一个非常长的侧边栏标题用于验证生成状态圆点不会被标题文本挤出可视区域 A',
  );
  const conversationB = await createNamedConversation(page, '长流式回归 B');

  const linkA = page.locator(`a[href="/chat/${conversationA}"]`);
  const linkB = page.locator(`a[href="/chat/${conversationB}"]`);
  await linkA.click();
  await waitForConversation(
    page,
    '这是一个非常长的侧边栏标题用于验证生成状态圆点不会被标题文本挤出可视区域 A',
  );
  await send(page, '浏览器并发长流式回归 A');
  await linkB.click();
  await waitForConversation(page, '长流式回归 B');
  await send(page, '浏览器并发长流式回归 B');

  await expect(page.getByLabel('正在生成')).toHaveCount(2);
  const titleA = linkA.locator('.conversation-link-title-text');
  const dotA = linkA.getByLabel('正在生成');
  expect(
    await titleA.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await dotA.evaluate((element) => {
      const dot = element.getBoundingClientRect();
      const link = element.closest('a')?.getBoundingClientRect();
      return Boolean(
        link &&
        dot.width > 0 &&
        dot.left >= link.left &&
        dot.right <= link.right,
      );
    }),
  ).toBe(true);

  await linkA.click();
  await waitForConversation(
    page,
    '这是一个非常长的侧边栏标题用于验证生成状态圆点不会被标题文本挤出可视区域 A',
  );
  const answer = page.getByRole('article', { name: '助手回答' }).last();
  const initialLength = (await answer.textContent())?.length ?? 0;
  await page.waitForTimeout(500);
  expect((await answer.textContent())?.length ?? 0).toBeGreaterThan(
    initialLength,
  );

  const viewport = page.locator('.message-viewport');
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    )
    .toBe(true);
  await viewport.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  const contentBeforeManualScroll = (await answer.textContent())?.length ?? 0;
  await page.waitForTimeout(300);
  expect((await answer.textContent())?.length ?? 0).toBeGreaterThan(
    contentBeforeManualScroll,
  );
  expect(
    await viewport.evaluate(
      (element) =>
        element.scrollHeight - element.clientHeight - element.scrollTop,
    ),
  ).toBeGreaterThan(48);

  const stopA = page.getByRole('button', { name: '停止生成' });
  if (await stopA.isVisible({ timeout: 1000 }).catch(() => false)) {
    await stopA.click();
  }
  await linkB.click();
  await waitForConversation(page, '长流式回归 B');
  const stopB = page.getByRole('button', { name: '停止生成' });
  if (await stopB.isVisible({ timeout: 1000 }).catch(() => false)) {
    await stopB.click();
  }
  await expect(page.getByLabel('正在生成')).toHaveCount(0, {
    timeout: 20_000,
  });
});

test('两个对话并发、路由切换复用连接且内容独立完成', async ({ page }) => {
  let eventConnections = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/events') {
      eventConnections += 1;
    }
  });

  await register(page);
  await createNamedConversation(page, '并发对话 A');
  await createNamedConversation(page, '并发对话 B');

  await page.getByRole('link', { name: /并发对话 A/ }).click();
  await waitForConversation(page, '并发对话 A');
  for (let iteration = 0; iteration < raceIterations; iteration += 1) {
    await send(page, `A-${iteration}`);
    await page.getByRole('link', { name: /并发对话 B/ }).click();
    await waitForConversation(page, '并发对话 B');
    await send(page, `B-${iteration}`);
    for (let switchIndex = 0; switchIndex < 5; switchIndex += 1) {
      const title = switchIndex % 2 === 0 ? '并发对话 A' : '并发对话 B';
      await page
        .getByRole('link', {
          name: title,
        })
        .click();
      await waitForConversation(page, title);
    }
    await page.getByRole('link', { name: /并发对话 B/ }).click();
    await waitForConversation(page, '并发对话 B');
    await expect(page.getByText('生成中…')).toHaveCount(0, { timeout: 5000 });
    await page.getByRole('link', { name: /并发对话 A/ }).click();
    await waitForConversation(page, '并发对话 A');
    await expect(page.getByText('生成中…')).toHaveCount(0, { timeout: 5000 });
  }

  await loadAllMessages(page);
  await expect
    .poll(() => page.getByText('这是实时流式回复。').count())
    .toBeGreaterThanOrEqual(raceIterations);
  await page.getByRole('link', { name: /并发对话 B/ }).click();
  await waitForConversation(page, '并发对话 B');
  await loadAllMessages(page);
  await expect
    .poll(() => page.getByText('这是实时流式回复。').count())
    .toBeGreaterThanOrEqual(raceIterations);
  expect(eventConnections).toBe(1);
});

test('停止对话 A 的任务不影响对话 B', async ({ page }) => {
  await register(page);
  await createNamedConversation(page, '停止目标 A');
  await createNamedConversation(page, '停止目标 B');
  await page.getByRole('link', { name: /停止目标 A/ }).click();
  await waitForConversation(page, '停止目标 A');
  await send(page, '停止 A');
  await page.getByRole('button', { name: '停止生成' }).click();
  await page.getByRole('link', { name: /停止目标 B/ }).click();
  await waitForConversation(page, '停止目标 B');
  await send(page, '保留 B');
  await expect(
    page
      .getByRole('article', { name: '助手回答' })
      .last()
      .getByText('这是实时流式回复。'),
  ).toBeVisible();
});

test('浏览器断网后按持久游标重连，100 个增量不重复也不遗漏', async ({
  page,
  context,
}) => {
  let eventConnections = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/events') {
      eventConnections += 1;
    }
  });
  await register(page);
  await createNamedConversation(page, '断网恢复回归');
  await send(page, '浏览器长流式回归 A');
  await expect(page.getByLabel('正在生成')).toHaveCount(1);
  const conversationUrl = page.url();
  await context.setOffline(true);
  await page.reload().catch(() => undefined);
  await page.waitForTimeout(500);
  await context.setOffline(false);
  await page.goto(conversationUrl);

  const answer = page.getByRole('article', { name: '助手回答' }).last();
  await expect(answer).toContainText('流式片段-100', { timeout: 15_000 });
  await expect(page.getByLabel('正在生成')).toHaveCount(0);
  const text = (await answer.textContent()) ?? '';
  const sequences = [...text.matchAll(/流式片段-(\d+)/g)].map((match) =>
    Number(match[1]),
  );
  expect(sequences).toEqual(
    Array.from({ length: 100 }, (_, index) => index + 1),
  );
  expect(eventConnections).toBeGreaterThanOrEqual(2);
});

test('两个独立浏览器 Context 最终内容摘要一致，任一端取消会同步', async ({
  page,
  browser,
}) => {
  const credentials = await register(page);
  const conversationId = await createNamedConversation(page, '跨标签恢复回归');
  await send(page, '浏览器长流式回归 A');

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await login(secondPage, credentials);
  await secondPage.goto(`/chat/${conversationId}`);
  await waitForConversation(secondPage, '跨标签恢复回归');
  await expect(secondPage.getByLabel('正在生成')).toHaveCount(1);
  await expect(
    secondPage.getByRole('article', { name: '助手回答' }).last(),
  ).toContainText('流式片段-100', { timeout: 15_000 });
  await expect(page.getByLabel('正在生成')).toHaveCount(0);

  const [firstHash, secondHash] = await Promise.all([
    answerHash(page),
    answerHash(secondPage),
  ]);
  expect(secondHash).toBe(firstHash);

  await send(page, '浏览器跨标签取消回归');
  await secondPage.reload();
  await waitForConversation(secondPage, '跨标签恢复回归');
  await expect(
    secondPage.getByRole('button', { name: '停止生成' }),
  ).toBeVisible();
  await secondPage.getByRole('button', { name: '停止生成' }).click();
  await expect(page.getByLabel('正在生成')).toHaveCount(0, {
    timeout: 5000,
  });
  await expect(secondPage.getByLabel('正在生成')).toHaveCount(0);
});

test('活动生成刷新恢复 p95 小于 2 秒', async ({ page }) => {
  await register(page);
  await createNamedConversation(page, '刷新恢复性能');
  await send(page, '浏览器恢复性能回归');
  const samples: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const startedAt = Date.now();
    await page.reload();
    await expect(
      page.getByRole('article', { name: '助手回答' }).last(),
    ).toContainText('流式片段-', { timeout: 2000 });
    samples.push(Date.now() - startedAt);
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!;
  expect(p95).toBeLessThan(2000);
  await page.getByRole('button', { name: '停止生成' }).click();
});

test('已缓存对话切换到可见 p95 小于 200 毫秒', async ({ page }) => {
  await register(page);
  const conversationA = await createNamedConversation(page, '缓存切换性能 A');
  const conversationB = await createNamedConversation(page, '缓存切换性能 B');
  const samples: number[] = [];

  for (let index = 0; index < 20; index += 1) {
    const targetId = index % 2 === 0 ? conversationA : conversationB;
    const targetTitle = index % 2 === 0 ? '缓存切换性能 A' : '缓存切换性能 B';
    const startedAt = performance.now();
    await page.locator(`a[href="/chat/${targetId}"]`).click();
    await expect(
      page.getByRole('heading', { name: targetTitle }),
    ).toBeVisible();
    samples.push(performance.now() - startedAt);
  }

  samples.sort((left, right) => left - right);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!;
  expect(p95).toBeLessThan(200);
});

test('应用内部事件转发 p95 小于 200 毫秒', async ({ page }) => {
  await register(page);
  await createNamedConversation(page, '事件转发性能');
  await send(page, '浏览器长流式回归 A');
  await expect(page.getByLabel('正在生成')).toHaveCount(0, { timeout: 15_000 });

  const apiPort = process.env.E2E_API_PORT ?? '3001';
  const response = await page.request.get(
    `http://127.0.0.1:${apiPort}/metrics`,
  );
  expect(response.ok()).toBe(true);
  const body = await response.text();
  const count = [
    ...body.matchAll(
      /^chat_event_forward_latency_seconds_count\{[^}]+\} (\d+)$/gm,
    ),
  ].reduce((sum, match) => sum + Number(match[1]), 0);
  const withinSlo = [
    ...body.matchAll(
      /^chat_event_forward_latency_seconds_bucket\{[^}]*le="0\.2"[^}]*\} (\d+)$/gm,
    ),
  ].reduce((sum, match) => sum + Number(match[1]), 0);
  expect(count).toBeGreaterThan(0);
  expect(withinSlo / count).toBeGreaterThanOrEqual(0.95);
});

async function register(page: import('@playwright/test').Page) {
  const credentials = {
    email: `phase6-${crypto.randomUUID()}@example.com`,
    password: 'a-secure-password',
  };
  await page.goto('/login');
  await page.getByRole('tab', { name: '注册' }).click();
  await page.getByLabel('邮箱').fill(credentials.email);
  await page.getByRole('textbox', { name: /^密码/ }).fill(credentials.password);
  await page.getByRole('button', { name: '创建账户' }).click();
  await expect(page).toHaveURL(/\/chat$/);
  return credentials;
}

async function login(
  page: import('@playwright/test').Page,
  credentials: { email: string; password: string },
) {
  await page.goto('/login');
  await page.getByLabel('邮箱').fill(credentials.email);
  await page.getByRole('textbox', { name: /^密码/ }).fill(credentials.password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(/\/chat$/);
}

async function answerHash(page: import('@playwright/test').Page) {
  const content =
    (await page
      .getByRole('article', { name: '助手回答' })
      .last()
      .textContent()) ?? '';
  return createHash('sha256').update(content).digest('hex');
}

async function createNamedConversation(
  page: import('@playwright/test').Page,
  title: string,
) {
  const previousUrl = page.url();
  await page.getByRole('button', { name: '新建对话' }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await page.getByRole('textbox', { name: '消息内容' }).fill(`创建 ${title}`);
  await page.getByRole('button', { name: '发送消息' }).click();
  await page.waitForURL(
    (url) =>
      /\/chat\/[0-9a-f-]{36}$/i.test(url.pathname) &&
      url.toString() !== previousUrl,
  );
  const conversationId = page.url().split('/').at(-1)!;
  const navigationItem = page
    .locator(`a[href="/chat/${conversationId}"]`)
    .locator('..');
  await navigationItem.getByRole('button').click();
  await page.getByRole('menuitem', { name: '重命名' }).click();
  await page.getByRole('textbox', { name: '对话名称' }).fill(title);
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByLabel('正在生成')).toHaveCount(0, { timeout: 5000 });
  return conversationId;
}

async function send(page: import('@playwright/test').Page, content: string) {
  const composer = page.getByRole('textbox', { name: '消息内容' });
  await composer.fill(content);
  await composer.press('Enter');
  await expect(page.getByText(content, { exact: true })).toBeVisible();
}

async function waitForConversation(
  page: import('@playwright/test').Page,
  title: string,
) {
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  // 后台标签可能暂停 requestAnimationFrame，使用浏览器外的短等待保证可结束。
  await page.waitForTimeout(50);
}

async function loadAllMessages(page: import('@playwright/test').Page) {
  const loadOlder = page.getByRole('button', { name: '载入更早消息' });
  while ((await loadOlder.count()) > 0) {
    await loadOlder.click();
    await expect(loadOlder).toHaveCount(0);
  }
}
