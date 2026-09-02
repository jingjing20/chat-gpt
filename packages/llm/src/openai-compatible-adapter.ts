/** 把 OpenAI 兼容 Chat Completions 请求与 SSE 响应转换为标准模型事件。 */

import { mapHttpError, ProviderError } from './provider-error';
import { parseDataOnlySse } from './sse-parser';
import type {
  LlmProviderAdapter,
  NormalizedChatRequest,
  NormalizedLlmEvent,
  NormalizedUsage,
} from './types';

type AdapterOptions = {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  fetch?: typeof fetch;
};

type StreamChunk = {
  id?: unknown;
  choices?: Array<{
    delta?: { content?: unknown; reasoning_content?: unknown };
    finish_reason?: unknown;
  }>;
  usage?: Record<string, unknown>;
};

export class OpenAiCompatibleAdapter implements LlmProviderAdapter {
  private readonly fetch: typeof fetch;

  constructor(private readonly options: AdapterOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  /** 发起可中止的流式请求，并将供应商 SSE 分片归一化为领域事件。 */
  async *streamChat(
    request: NormalizedChatRequest,
    signal: AbortSignal,
  ): AsyncIterable<NormalizedLlmEvent> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const combinedSignal = AbortSignal.any([signal, timeout]);
    let response: Response;
    try {
      response = await this.fetch(
        `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.options.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(this.toProviderRequest(request)),
          signal: combinedSignal,
        },
      );
    } catch (cause) {
      throw this.mapFetchError(cause, timeout.aborted);
    }

    if (!response.ok) throw mapHttpError(response.status);
    if (!response.body) {
      throw new ProviderError({
        code: 'MALFORMED_STREAM',
        retryableBeforeFirstDelta: true,
        safeMessage: '模型供应商未返回流式响应',
      });
    }

    let receivedDelta = false;
    try {
      for await (const data of parseDataOnlySse(response.body)) {
        if (data === '[DONE]') return;
        for (const event of this.normalizeChunk(data)) {
          if (
            event.type === 'content_delta' ||
            event.type === 'reasoning_delta'
          ) {
            receivedDelta = true;
          }
          yield event;
        }
      }
    } catch (cause) {
      const error =
        cause instanceof ProviderError
          ? cause
          : this.mapFetchError(cause, timeout.aborted);
      if (!receivedDelta || !error.retryableBeforeFirstDelta) throw error;
      throw new ProviderError({
        code: error.code,
        retryableBeforeFirstDelta: false,
        safeMessage: error.message,
        ...(error.httpStatus === undefined
          ? {}
          : { httpStatus: error.httpStatus }),
        cause: error,
      });
    }
  }

  /** 只映射标准 Chat Completions 字段，避免业务层依赖供应商专属结构。 */
  private toProviderRequest(
    request: NormalizedChatRequest,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (request.maxOutputTokens !== undefined)
      payload.max_tokens = request.maxOutputTokens;
    if (request.userId !== undefined) payload.user_id = request.userId;
    if (request.reasoning !== undefined) {
      payload.thinking = {
        type: request.reasoning.enabled ? 'enabled' : 'disabled',
      };
      if (request.reasoning.enabled && request.reasoning.effort !== undefined)
        payload.reasoning_effort = request.reasoning.effort;
    }
    return payload;
  }

  private *normalizeChunk(data: string): Iterable<NormalizedLlmEvent> {
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(data) as StreamChunk;
    } catch (cause) {
      throw new ProviderError({
        code: 'MALFORMED_STREAM',
        retryableBeforeFirstDelta: true,
        safeMessage: '模型供应商返回了无法解析的流数据',
        cause,
      });
    }
    for (const choice of chunk.choices ?? []) {
      const reasoning = choice.delta?.reasoning_content;
      const content = choice.delta?.content;
      if (typeof reasoning === 'string' && reasoning.length > 0)
        yield { type: 'reasoning_delta', delta: reasoning };
      if (typeof content === 'string' && content.length > 0)
        yield { type: 'content_delta', delta: content };
      if (typeof choice.finish_reason === 'string') {
        yield {
          type: 'finish',
          finishReason: choice.finish_reason,
          ...(typeof chunk.id === 'string'
            ? { providerRequestId: chunk.id }
            : {}),
        };
      }
    }
    if (chunk.usage)
      yield { type: 'usage', usage: normalizeUsage(chunk.usage) };
  }

  /** 区分调用方取消、适配器超时和网络故障，以决定上层是否可重试。 */
  private mapFetchError(cause: unknown, timedOut: boolean): ProviderError {
    if (timedOut) {
      return new ProviderError({
        code: 'TIMEOUT',
        retryableBeforeFirstDelta: true,
        safeMessage: '模型请求超时',
        cause,
      });
    }
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      return new ProviderError({
        code: 'CONNECTION_LOST',
        retryableBeforeFirstDelta: false,
        safeMessage: '模型请求已取消',
        cause,
      });
    }
    return new ProviderError({
      code: 'CONNECTION_LOST',
      retryableBeforeFirstDelta: true,
      safeMessage: '模型供应商连接中断',
      cause,
    });
  }
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function normalizeUsage(usage: Record<string, unknown>): NormalizedUsage {
  const completionDetails = (usage.completion_tokens_details ?? {}) as Record<
    string,
    unknown
  >;
  return {
    promptTokens: number(usage.prompt_tokens),
    completionTokens: number(usage.completion_tokens),
    totalTokens: number(usage.total_tokens),
    reasoningTokens: number(completionDetails.reasoning_tokens),
    cacheHitTokens: number(usage.prompt_cache_hit_tokens),
    cacheMissTokens: number(usage.prompt_cache_miss_tokens),
  };
}
