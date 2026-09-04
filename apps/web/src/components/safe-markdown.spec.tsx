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

test('支持 GFM 表格、代码高亮和 Mermaid 代码块', () => {
  const html = renderToStaticMarkup(
    <SafeMarkdown
      content={
        '| 功能 | 状态 |\n| --- | --- |\n| Markdown | ✅ |\n\n' +
        '```ts\nconst answer = 42;\n```\n\n' +
        '```mermaid\ngraph TD\n  A --> B\n```'
      }
    />,
  );

  assert.match(html, /<table>/);
  assert.match(html, /class="hljs-keyword"/);
  assert.match(html, /正在绘制流程图/);
});

test('普通文本中的单换行会渲染为可见换行', () => {
  const html = renderToStaticMarkup(
    <SafeMarkdown content={'**知识问答**：解答问题\n**写作辅助**：帮你写文章'} />,
  );

  assert.match(
    html,
    /<strong>知识问答<\/strong>：解答问题<br\/>\s*<strong>写作辅助<\/strong>：帮你写文章/,
  );
});
