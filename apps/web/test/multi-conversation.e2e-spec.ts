import { expect, test } from '@playwright/test';

const raceIterations = Number(process.env.PHASE_6_RACE_ITERATIONS ?? 20);

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

async function register(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: '注册' }).click();
  await page
    .getByLabel('邮箱')
    .fill(`phase6-${crypto.randomUUID()}@example.com`);
  await page.getByLabel('密码').fill('a-secure-password');
  await page.getByRole('button', { name: '注册并开始' }).click();
  await expect(page).toHaveURL(/\/chat$/);
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
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function loadAllMessages(page: import('@playwright/test').Page) {
  const loadOlder = page.getByRole('button', { name: '载入更早消息' });
  while ((await loadOlder.count()) > 0) {
    await loadOlder.click();
    await expect(loadOlder).toHaveCount(0);
  }
}
