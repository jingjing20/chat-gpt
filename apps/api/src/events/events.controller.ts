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

  @Get('sync')
  sync(@Req() request: Request) {
    return this.events.sync(request.auth!.userId);
  }

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
