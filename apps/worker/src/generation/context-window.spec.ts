/** 验证上下文 token 估算、旧消息裁剪和单消息截断策略。 */

import type { NormalizedChatMessage } from '@chat/llm';
import {
  createConfiguredModelProfile,
  estimateMessageTokens,
  fitMessagesToContextWindow,
} from './context-window';

const profile = createConfiguredModelProfile({
  provider: 'fake',
  model: 'fake-long-context',
  contextWindow: 32,
  maxOutputTokens: 12,
  reasoningEnabled: true,
});

describe('上下文窗口预算', () => {
  it('按消息边界丢弃最旧历史，同时保留 system 和最近轮次', () => {
    const messages: NormalizedChatMessage[] = [
      { role: 'system', content: '规则' },
      { role: 'user', content: 'old '.repeat(20) },
      { role: 'assistant', content: 'older '.repeat(20) },
      { role: 'user', content: '最新问题' },
    ];

    const result = fitMessagesToContextWindow(messages, profile);

    expect(result.messages).toEqual([
      { role: 'system', content: '规则' },
      { role: 'user', content: '最新问题' },
    ]);
    expect(result.droppedMessageCount).toBe(2);
    expect(result.estimatedInputTokens).toBeLessThanOrEqual(20);
  });

  it('单条最新消息超限时确定性保留尾部', () => {
    const result = fitMessagesToContextWindow(
      [{ role: 'user', content: '甲'.repeat(100) }],
      profile,
    );

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content).toBe('甲'.repeat(16));
    expect(result.truncatedMessageCount).toBe(1);
    expect(result.estimatedInputTokens).toBeLessThanOrEqual(20);
  });

  it('ASCII 与非 ASCII 使用保守且稳定的估算规则', () => {
    expect(estimateMessageTokens({ role: 'user', content: 'abcdefgh' })).toBe(
      6,
    );
    expect(estimateMessageTokens({ role: 'user', content: '中文' })).toBe(6);
  });
});
