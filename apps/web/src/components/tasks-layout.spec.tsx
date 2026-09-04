import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolve } from 'node:path';

test('定时任务页面只在内容区滚动，不让整个聊天舞台产生第二层滚动', () => {
  const css = readFileSync(
    resolve(process.cwd(), 'src/app/globals.css'),
    'utf8',
  );
  assert.match(css, /\.chat-stage\s*{[^}]*overflow:\s*hidden/);
  assert.match(
    css,
    /\.tasks-page\s*{[^}]*height:\s*100%[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/,
  );
});
