'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

export function AnswerActions({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <div className="answer-actions">
      <button aria-label="复制回答" onClick={copy} type="button">
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        <span>{copied ? '已复制' : '复制回答'}</span>
      </button>
    </div>
  );
}
