/** 提供用户级 SSE 事件流、历史补偿和活动 generation 同步接口。 */

import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiException } from '../http/api-exception';
import { EventsService } from './events.service';

const streamCursorSchema = z
  .string()
  .regex(/^\d+-\d+$/)
  .default('0-0');
const sequenceSchema = z.coerce.number().int().nonnegative().default(0);
const idSchema = z.string().uuid();

@Controller()
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /**
   * 从认证上下文确定用户身份，不接受客户端指定 userId，防止跨用户订阅事件。
   */
  @Get('events')
  async stream(
    @Req() request: Request,
    @Res() response: Response,
    @Query('after') after?: string,
  ): Promise<void> {
    await this.events.stream(
      request.auth!.userId,
      this.parse(streamCursorSchema, after),
      request,
      response,
    );
  }

  /**
   * 返回当前用户的活动 generation 快照和后续开流所需的基线游标。
   */
  @Get('sync')
  sync(@Req() request: Request) {
    return this.events.sync(request.auth!.userId);
  }

  /**
   * 按 generation 和 sequence 定向补偿，不扫描用户级事件历史。
   */
  @Get('generations/:generationId/events')
  history(
    @Req() request: Request,
    @Param('generationId') generationId: string,
    @Query('after_sequence') afterSequence?: string,
  ) {
    return this.events.history(
      request.auth!.userId,
      this.parse(idSchema, generationId),
      this.parse(sequenceSchema, afterSequence),
    );
  }

  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new ApiException('VALIDATION_ERROR', '事件游标不合法', 422);
    }
    return parsed.data;
  }
}
