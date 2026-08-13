import { expect, test } from '@playwright/test';

test('恶意 Markdown 不能执行，刷新后对话和消息仍然存在', async ({ page }) => {
  const email = `xss-${Date.now()}@example.com`;
  await page.goto('/login');
  await page.getByRole('button', { name: '注册' }).click();
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill('a-secure-password');
  await page.getByRole('button', { name: '注册并开始' }).click();
  await expect(page).toHaveURL(/\/chat$/);

  const payload =
    '**安全文本** <script>globalThis.__xssExecuted=true</script> ' +
    '<img src=x onerror="globalThis.__xssExecuted=true"> ' +
    '[危险链接](javascript:globalThis.__xssExecuted=true)';
  await page.getByRole('textbox', { name: '消息内容' }).fill(payload);
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/i);

  await expect(page.getByText('安全文本', { exact: true })).toBeVisible();
  await expect(page.getByText(/这是实时流式回复/)).toBeVisible();
  const completedReasoning = page.getByRole('button', { name: '推理过程' });
  await expect(completedReasoning).toHaveAttribute('aria-expanded', 'false');
  await completedReasoning.click();
  await expect(page.getByText('安全分析')).toBeVisible();
  expect(
    await page.locator('script').filter({ hasText: '__xssExecuted' }).count(),
  ).toBe(0);
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  expect(
    await page.evaluate(() =>
      Boolean(
        (globalThis as typeof globalThis & { __xssExecuted?: boolean })
          .__xssExecuted,
      ),
    ),
  ).toBe(false);

  await page.reload();
  await expect(page.getByText('安全文本', { exact: true })).toBeVisible();
  await expect(page.getByText(/这是实时流式回复/)).toBeVisible();
  expect(
    await page.evaluate(() =>
      Boolean(
        (globalThis as typeof globalThis & { __xssExecuted?: boolean })
          .__xssExecuted,
      ),
    ),
  ).toBe(false);
});

test('Markdown 分隔线和列表保留可读的排版样式', async ({ page }) => {
  const email = `markdown-style-${Date.now()}@example.com`;
  await page.goto('/login');
  await page.getByRole('button', { name: '注册' }).click();
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill('a-secure-password');
  await page.getByRole('button', { name: '注册并开始' }).click();

  await page
    .getByRole('textbox', { name: '消息内容' })
    .fill('分隔线上方\n\n---\n\n- 第一项\n- 第二项\n\n1. 第一步\n2. 第二步');
  await page.getByRole('button', { name: '发送消息' }).click();

  const userMessage = page.getByRole('article', { name: '你的消息' });
  const separator = userMessage.locator('hr');
  const unorderedList = userMessage.locator('ul');
  const orderedList = userMessage.locator('ol');
  const secondUnorderedItem = unorderedList.locator('li').nth(1);

  await expect(separator).toHaveCSS('margin-top', '32px');
  await expect(separator).toHaveCSS('margin-bottom', '32px');
  await expect(unorderedList).toHaveCSS('padding-left', '18px');
  await expect(unorderedList.locator('li').first()).toHaveCSS(
    'list-style-type',
    'disc',
  );
  await expect(orderedList.locator('li').first()).toHaveCSS(
    'list-style-type',
    'decimal',
  );
  await expect(secondUnorderedItem).toHaveCSS('margin-top', '6px');
});
