'use client';

import { Collapsible } from '@base-ui/react/collapsible';
import type { GenerationStatus } from '@chat/contracts';
import { ChevronRight, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { isGenerationActive } from '@/lib/generation-store';
import { SafeMarkdown } from './safe-markdown';

export function ReasoningPanel({
  content,
  status,
}: {
  content: string;
  status: GenerationStatus | 'PENDING';
}) {
  const isActive = status === 'PENDING' || isGenerationActive(status);

  return (
    <ReasoningPanelState
      content={content}
      isActive={isActive}
      key={isActive ? 'active' : 'terminal'}
    />
  );
}

function ReasoningPanelState({
  content,
  isActive,
}: {
  content: string;
  isActive: boolean;
}) {
  const [open, setOpen] = useState(isActive);

  return (
    <Collapsible.Root
      className="reasoning-block"
      onOpenChange={setOpen}
      open={open}
    >
      <Collapsible.Trigger className="reasoning-trigger">
        {isActive ? (
          <Sparkles aria-hidden="true" size={14} />
        ) : (
          <ChevronRight
            aria-hidden="true"
            className="reasoning-chevron"
            size={14}
          />
        )}
        <span>{isActive ? '正在思考' : '推理过程'}</span>
      </Collapsible.Trigger>
      <Collapsible.Panel className="reasoning-panel">
        <SafeMarkdown content={content} />
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
