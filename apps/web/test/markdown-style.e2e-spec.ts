import { expect, test } from '@playwright/test';

test('Markdown 常用语义保留完整且可读的排版样式', async ({ page }) => {
  const email = `markdown-style-${Date.now()}@example.com`;
  await page.goto('/login');
  await page.getByRole('button', { name: '注册' }).click();
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill('a-secure-password');
  await page.getByRole('button', { name: '创建账户' }).click();

  const markdown = [
    '# 一级标题',
    '',
    '## 二级标题',
    '',
    '### 三级标题',
    '',
    '#### 四级标题',
    '',
    '##### 五级标题',
    '',
    '###### 六级标题',
    '',
    '普通段落包含 **加粗**、*强调*、~~删除~~、`inline` 和 [链接](https://example.com)。',
    '',
    '---',
    '',
    '- 第一项',
    '  - 二级嵌套项',
    '    - 三级嵌套项',
    '- 第二项',
    '',
    '1. 第一步',
    '   1. 子步骤',
    '2. 第二步',
    '',
    '- [ ] 待办事项',
    '- [x] 已完成事项',
    '',
    '> 引用段落',
    '',
    '| 列一 | 列二 |',
    '| --- | --- |',
    '| 内容 | 内容 |',
    '',
    '```ts',
    'const answer = 42;',
    '```',
    '',
    '![示例图片](https://example.com/example.png)',
  ].join('\n');

  await page.getByRole('textbox', { name: '消息内容' }).fill(markdown);
  await page.getByRole('button', { name: '发送消息' }).click();

  const message = page.getByRole('article', { name: '你的消息' });
  const separator = message.locator('hr');
  const topLevelList = message.locator('ul').first();
  const nestedList = topLevelList.locator('ul');
  const thirdLevelList = nestedList.locator('ul');
  const orderedList = message.locator('ol').first();
  const nestedOrderedList = orderedList.locator('ol');
  const taskList = message.locator('ul.contains-task-list');
  const link = message.getByRole('link', { name: '链接' });

  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    await expect(message.getByRole('heading', { level })).toHaveCSS(
      'font-weight',
      '650',
    );
  }
  await expect(message.getByRole('heading', { level: 5 })).toHaveCSS(
    'font-size',
    '15.04px',
  );
  await expect(message.getByRole('heading', { level: 6 })).toHaveCSS(
    'font-size',
    '14.08px',
  );
  await expect(message.locator('p').first()).toHaveCSS('margin-top', '16px');
  await expect(separator).toHaveCSS('margin-top', '32px');
  await expect(separator).toHaveCSS('margin-bottom', '32px');
  await expect(topLevelList).toHaveCSS('padding-left', '18px');
  await expect(topLevelList.locator(':scope > li').first()).toHaveCSS(
    'list-style-type',
    'disc',
  );
  await expect(nestedList.locator('li').first()).toHaveCSS(
    'list-style-type',
    'circle',
  );
  await expect(thirdLevelList.locator('li').first()).toHaveCSS(
    'list-style-type',
    'square',
  );
  await expect(orderedList.locator('li').first()).toHaveCSS(
    'list-style-type',
    'decimal',
  );
  await expect(nestedOrderedList.locator('li').first()).toHaveCSS(
    'list-style-type',
    'lower-alpha',
  );
  expect(
    await topLevelList
      .locator(':scope > li')
      .first()
      .evaluate((element) => getComputedStyle(element, '::marker').color),
  ).toBe('rgb(168, 181, 174)');
  await expect(taskList).toHaveCSS('list-style-type', 'none');
  await expect(taskList).toHaveCSS('padding-left', '0px');
  const taskCheckboxes = taskList.locator('input[type="checkbox"]');
  await expect(taskCheckboxes).toHaveCount(2);
  await expect(taskCheckboxes.first()).toHaveCSS(
    'accent-color',
    'rgb(103, 221, 160)',
  );
  await expect(message.locator('strong')).toHaveCSS('font-weight', '650');
  await expect(message.locator('em')).toHaveCSS('font-style', 'italic');
  await expect(link).toHaveCSS('text-decoration-line', 'underline');
  await link.hover();
  await expect(link).toHaveCSS('text-decoration-color', 'rgb(154, 245, 189)');
  await link.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(link).toHaveCSS('outline-style', 'solid');
  await expect(message.locator('del')).toHaveCSS('color', 'rgb(145, 160, 152)');
  await expect(message.locator('code').filter({ hasText: 'inline' })).toHaveCSS(
    'font-size',
    '14px',
  );
  const blockquoteParagraph = message.locator('blockquote p');
  await expect(blockquoteParagraph).toHaveCSS('margin-top', '0px');
  await expect(blockquoteParagraph).toHaveCSS('margin-bottom', '0px');
  await expect(message.locator('td').first()).toHaveCSS(
    'vertical-align',
    'top',
  );
  await expect(message.locator('.code-block pre code')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  );
  await expect(message.getByRole('img', { name: '示例图片' })).toHaveCSS(
    'max-width',
    '100%',
  );
});
