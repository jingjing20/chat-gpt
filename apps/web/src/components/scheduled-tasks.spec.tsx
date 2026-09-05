import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('定时任务页包含任务输入、活动入口和推荐任务', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/components/scheduled-tasks.tsx'),
    'utf8',
  );
  assert.match(source, /<h1>定时任务<\/h1>/);
  assert.match(source, /aria-label="任务描述"/);
  assert.match(source, /task-filter-menu/);
  assert.match(source, /createConversationWithGeneration/);
  assert.match(source, /taskQuestionnaire:\s*true/);
  assert.doesNotMatch(source, /questionnairePrompt/);
  assert.match(source, /AI 技术与市场简报/);
});

test('立即运行后注册生成状态并跳转到新对话', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/components/task-actions.tsx'),
    'utf8',
  );
  assert.match(source, /useGenerationStore\.getState\(\)\.register/);
  assert.match(
    source,
    /router\.push\(`\/chat\/\$\{result\.conversation\.id\}`\)/,
  );
  assert.match(source, /查看最近结果/);
});

test('后台任务终态会显示可跳转的站内通知', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/components/generation-manager.tsx'),
    'utf8',
  );
  assert.match(source, /scheduledTaskFromEvent/);
  assert.match(source, /className="task-notifications"/);
  assert.match(
    source,
    /router\.push\(`\/chat\/\$\{notification\.conversationId\}`\)/,
  );
});
