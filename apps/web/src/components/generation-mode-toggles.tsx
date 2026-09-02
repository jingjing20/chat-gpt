import { Atom } from 'lucide-react';
import type { GenerationModes } from '@/lib/chat-api';

export function GenerationModeToggles({
  modes,
  onChange,
  disabled = false,
}: {
  modes: GenerationModes;
  onChange: (modes: GenerationModes) => void;
  disabled?: boolean;
}) {
  return (
    <div aria-label="生成模式" className="generation-mode-toggles">
      <button
        aria-pressed={modes.reasoningEnabled}
        className={modes.reasoningEnabled ? 'active' : undefined}
        disabled={disabled}
        onClick={() =>
          onChange({
            ...modes,
            reasoningEnabled: !modes.reasoningEnabled,
          })
        }
        title="让模型在回答前进行更深入的推理"
        type="button"
      >
        <Atom aria-hidden="true" size={16} />
        深度思考
      </button>
    </div>
  );
}
