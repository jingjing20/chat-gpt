import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafeMarkdown } from './safe-markdown';

test('Markdown 渲染不会输出原始 HTML、脚本或危险链接', () => {
  const html = renderToStaticMarkup(
    <SafeMarkdown
      content={
        '**安全文本** <script>globalThis.hacked=true</script> ' +
        '<img src=x onerror="globalThis.hacked=true"> ' +
        '[危险链接](javascript:alert(1))'
      }
    />,
  );

  assert.match(html, /<strong>安全文本<\/strong>/);
  assert.doesNotMatch(html, /<script|<img|onerror|javascript:/i);
});
