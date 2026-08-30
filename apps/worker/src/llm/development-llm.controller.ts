/** 提供仅开发环境使用的 OpenAI 兼容流式假模型端点。 */

import { readWorkerEnv } from '@chat/config';
import {
  OpenAiCompatibleAdapter,
  ProviderError,
  type NormalizedChatMessage,
} from '@chat/llm';
import {
  BadRequestException,
  Controller,
  NotFoundException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

type DevelopmentStreamBody = {
  messages?: NormalizedChatMessage[];
};

@Controller('development/llm')
export class DevelopmentLlmController {
  @Post('stream')
  async stream(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const environment = readWorkerEnv(process.env);
    if (environment.NODE_ENV !== 'development') throw new NotFoundException();
    if (!environment.LLM_API_KEY) {
      throw new BadRequestException('开发流测试需要配置 LLM_API_KEY');
    }
    const messages = validateMessages(
      (request.body as DevelopmentStreamBody).messages,
    );
    const abortController = new AbortController();
    response.once('close', () => {
      if (!response.writableEnded) abortController.abort();
    });
    response.status(200);
    response.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
    response.setHeader('cache-control', 'no-store');

    const adapter = new OpenAiCompatibleAdapter({
      baseUrl: environment.LLM_BASE_URL,
      apiKey: environment.LLM_API_KEY,
      timeoutMs: environment.LLM_REQUEST_TIMEOUT_MS,
    });
    try {
      for await (const event of adapter.streamChat(
        {
          model: environment.LLM_DEFAULT_MODEL,
          messages,
          maxOutputTokens: environment.LLM_MAX_OUTPUT_TOKENS,
          reasoning: {
            enabled: environment.LLM_REASONING_MODE === 'enabled',
            effort: environment.LLM_REASONING_EFFORT,
          },
        },
        abortController.signal,
      )) {
        response.write(`${JSON.stringify(event)}\n`);
      }
    } catch (error) {
      if (!response.writableEnded && error instanceof ProviderError) {
        response.write(
          `${JSON.stringify({ type: 'error', code: error.code, message: error.message })}\n`,
        );
      }
    } finally {
      if (!response.writableEnded) response.end();
    }
  }
}

function validateMessages(value: unknown): NormalizedChatMessage[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(
      (message: unknown) =>
        typeof message === 'object' &&
        message !== null &&
        'role' in message &&
        ['system', 'user', 'assistant'].includes(String(message.role)) &&
        'content' in message &&
        typeof message.content === 'string' &&
        message.content.length > 0,
    )
  ) {
    throw new BadRequestException('messages 必须是非空的标准聊天消息数组');
  }
  return value as NormalizedChatMessage[];
}
