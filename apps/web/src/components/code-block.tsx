'use client';

import { Check, Copy, Download } from 'lucide-react';
import { isValidElement, useState, type ReactNode } from 'react';

function plainText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(plainText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return plainText(node.props.children);
  }
  return '';
}

export function CodeBlock({
  children,
  language,
}: {
  children: ReactNode;
  language?: string;
}) {
  const [copied, setCopied] = useState(false);
  const code = plainText(children).replace(/\n$/, '');
  const label = language || '代码';

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  function download() {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `snippet.${language || 'txt'}`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="code-block">
      <div className="code-block-toolbar">
        <span>{label}</span>
        <div>
          <button aria-label="复制代码" onClick={copy} type="button">
            {copied ? (
              <Check aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
            {copied ? '已复制' : '复制'}
          </button>
          <button aria-label="下载代码" onClick={download} type="button">
            <Download aria-hidden="true" />
            下载
          </button>
        </div>
      </div>
      <pre>
        <code className={language ? `language-${language}` : undefined}>
          {children}
        </code>
      </pre>
    </div>
  );
}
