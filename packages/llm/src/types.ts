export type NormalizedChatRole = 'system' | 'user' | 'assistant';

export type NormalizedChatMessage = {
  role: NormalizedChatRole;
  content: string;
};

export type NormalizedChatRequest = {
  model: string;
  messages: NormalizedChatMessage[];
  maxOutputTokens?: number;
  reasoning?: { enabled: boolean; effort?: 'low' | 'medium' | 'high' };
  userId?: string;
};

export type NormalizedUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
};

export type NormalizedLlmEvent =
  | { type: 'reasoning_delta'; delta: string }
  | { type: 'content_delta'; delta: string }
  | { type: 'usage'; usage: NormalizedUsage }
  | { type: 'finish'; finishReason: string; providerRequestId?: string };

export type ProviderErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'INSUFFICIENT_BALANCE'
  | 'INVALID_REQUEST'
  | 'RATE_LIMITED'
  | 'OVERLOADED'
  | 'TIMEOUT'
  | 'CONNECTION_LOST'
  | 'MALFORMED_STREAM'
  | 'UNKNOWN';

export interface LlmProviderAdapter {
  streamChat(
    request: NormalizedChatRequest,
    signal: AbortSignal,
  ): AsyncIterable<NormalizedLlmEvent>;
}
