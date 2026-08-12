import type { NormalizedChatMessage } from '@chat/llm';

export interface ModelProfile {
  provider: string;
  model: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsReasoning: boolean;
  supportsUsageInStream: boolean;
}

export interface ContextWindowResult {
  messages: NormalizedChatMessage[];
  estimatedInputTokens: number;
  droppedMessageCount: number;
  truncatedMessageCount: number;
}

const MESSAGE_OVERHEAD_TOKENS = 4;

/**
 * 这是用于预算保护的保守估算，不用于计费。中文按每字一个 token、ASCII
 * 按四字符一个 token 估算，并为消息结构保留固定开销。
 */
export function estimateMessageTokens(message: NormalizedChatMessage): number {
  let asciiCharacters = 0;
  let nonAsciiCharacters = 0;
  for (const character of message.content) {
    if (character.codePointAt(0)! <= 0x7f) asciiCharacters += 1;
    else nonAsciiCharacters += 1;
  }
  return (
    MESSAGE_OVERHEAD_TOKENS +
    Math.ceil(asciiCharacters / 4) +
    nonAsciiCharacters
  );
}

function truncateToTokenBudget(
  message: NormalizedChatMessage,
  budget: number,
  keep: 'start' | 'end',
): NormalizedChatMessage | null {
  if (budget <= MESSAGE_OVERHEAD_TOKENS) return null;
  let content = '';
  const characters = [...message.content];
  const ordered = keep === 'start' ? characters : characters.reverse();
  for (const character of ordered) {
    const candidate =
      keep === 'start' ? `${content}${character}` : `${character}${content}`;
    if (estimateMessageTokens({ ...message, content: candidate }) > budget)
      break;
    content = candidate;
  }
  return content ? { ...message, content } : null;
}

/** 保留 system 和最近轮次，普通历史从最旧消息开始整条裁剪。 */
export function fitMessagesToContextWindow(
  messages: NormalizedChatMessage[],
  profile: ModelProfile,
): ContextWindowResult {
  const inputBudget = Math.max(
    1,
    profile.contextWindow - profile.maxOutputTokens,
  );
  const systemMessages = messages.filter(
    (message) => message.role === 'system',
  );
  const regularMessages = messages.filter(
    (message) => message.role !== 'system',
  );
  const keptSystem: NormalizedChatMessage[] = [];
  const keptRegular: NormalizedChatMessage[] = [];
  let remaining = inputBudget;
  let truncatedMessageCount = 0;

  for (const message of systemMessages) {
    const tokens = estimateMessageTokens(message);
    if (tokens <= remaining) {
      keptSystem.push(message);
      remaining -= tokens;
      continue;
    }
    const truncated = truncateToTokenBudget(message, remaining, 'start');
    if (truncated) {
      keptSystem.push(truncated);
      remaining -= estimateMessageTokens(truncated);
      truncatedMessageCount += 1;
    }
    break;
  }

  for (let index = regularMessages.length - 1; index >= 0; index -= 1) {
    const message = regularMessages[index];
    const tokens = estimateMessageTokens(message);
    if (tokens <= remaining) {
      keptRegular.unshift(message);
      remaining -= tokens;
      continue;
    }
    // 最新一条用户输入本身过长时保留尾部，保证请求仍有确定的可发送内容。
    if (keptRegular.length === 0) {
      const truncated = truncateToTokenBudget(message, remaining, 'end');
      if (truncated) {
        keptRegular.unshift(truncated);
        remaining -= estimateMessageTokens(truncated);
        truncatedMessageCount += 1;
      }
    }
    break;
  }

  const fitted = [...keptSystem, ...keptRegular];
  return {
    messages: fitted,
    estimatedInputTokens: fitted.reduce(
      (total, message) => total + estimateMessageTokens(message),
      0,
    ),
    droppedMessageCount:
      messages.length - fitted.length + truncatedMessageCount,
    truncatedMessageCount,
  };
}

export function createConfiguredModelProfile(input: {
  provider: string;
  model: string;
  contextWindow: number;
  maxOutputTokens: number;
  reasoningEnabled: boolean;
}): ModelProfile {
  return {
    provider: input.provider,
    model: input.model,
    contextWindow: input.contextWindow,
    maxOutputTokens: Math.min(input.maxOutputTokens, input.contextWindow - 1),
    supportsReasoning: input.reasoningEnabled,
    supportsUsageInStream: true,
  };
}
