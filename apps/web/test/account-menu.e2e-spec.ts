import { expect, test } from '@playwright/test';

test('账户菜单在侧栏展开和收起时均可用', async ({ page }) => {
  const email = `account-menu-${crypto.randomUUID()}@example.com`;

  await page.goto('/login');
  await page.getByRole('tab', { name: '注册' }).click();
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('textbox', { name: /^密码/ }).fill('a-secure-password');
  await page.getByRole('button', { name: '创建账户' }).click();
  await expect(page).toHaveURL(/\/chat$/);

  const accountTrigger = page.getByRole('button', { name: '打开账户菜单' });
  await accountTrigger.click();
  await expect(page.getByRole('menuitem', { name: '设置' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '退出登录' })).toBeVisible();

  await page.getByRole('main').click({ position: { x: 400, y: 200 } });
  await expect(page.getByRole('menuitem', { name: '设置' })).toHaveCount(0);

  await page.getByRole('button', { name: '收起侧边栏' }).click();
  await expect(page.locator('.chat-shell')).toHaveClass(/sidebar-collapsed/);
  await expect(page.getByRole('link', { name: 'Lucidra' })).toBeHidden();
  await expect(accountTrigger).toBeVisible();

  const toggleBox = await page
    .getByRole('button', { name: '展开侧边栏' })
    .boundingBox();
  const newConversationBox = await page
    .getByRole('button', { name: '新建对话' })
    .boundingBox();
  expect(toggleBox?.width).toBe(newConversationBox?.width);
  expect(toggleBox?.height).toBe(newConversationBox?.height);

  const sidebarBox = await page.locator('.sidebar').boundingBox();
  const accountBox = await page.locator('.account-area').boundingBox();
  expect(sidebarBox).not.toBeNull();
  expect(accountBox).not.toBeNull();
  expect(
    Math.abs(
      (sidebarBox?.y ?? 0) +
        (sidebarBox?.height ?? 0) -
        ((accountBox?.y ?? 0) + (accountBox?.height ?? 0)),
    ),
  ).toBeLessThanOrEqual(1);

  await accountTrigger.click();
  await page.getByRole('menuitem', { name: '设置' }).click();
  await expect(page).toHaveURL(/\/settings$/);
});
