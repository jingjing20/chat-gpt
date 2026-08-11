import {
  createGenerationRequestSchema,
  type CreateGenerationRequest,
} from '@chat/contracts';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ApiException } from '../http/api-exception';
import { ZodBodyPipe } from '../http/zod-body.pipe';
import { GenerationsService } from './generations.service';

const idSchema = z.string().uuid();
const idempotencyKeySchema = z.string().trim().min(1).max(100);

@Controller()
export class GenerationsController {
  constructor(private readonly generations: GenerationsService) {}

  @Post('conversations/:conversationId/generations')
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @Req() request: Request,
    @Param('conversationId') conversationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodBodyPipe(createGenerationRequestSchema))
    body: CreateGenerationRequest,
  ) {
    return this.generations.create(
      request.auth!.userId,
      this.id(conversationId),
      this.idempotencyKey(idempotencyKey),
      body,
    );
  }

  @Get('generations/:generationId')
  get(@Req() request: Request, @Param('generationId') generationId: string) {
    return this.generations.get(request.auth!.userId, this.id(generationId));
  }

  @Get('generations/:generationId/attempts')
  attempts(
    @Req() request: Request,
    @Param('generationId') generationId: string,
  ) {
    return this.generations.attempts(
      request.auth!.userId,
      this.id(generationId),
    );
  }

  @Post('generations/:generationId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Req() request: Request, @Param('generationId') generationId: string) {
    return this.generations.cancel(request.auth!.userId, this.id(generationId));
  }

  private id(value: string): string {
    const parsed = idSchema.safeParse(value);
    if (!parsed.success) this.validationError('资源 ID 不合法');
    return parsed.data;
  }

  private idempotencyKey(value: string | undefined): string {
    const parsed = idempotencyKeySchema.safeParse(value);
    if (!parsed.success) this.validationError('缺少或无效的 Idempotency-Key');
    return parsed.data;
  }

  private validationError(message: string): never {
    throw new ApiException(
      'VALIDATION_ERROR',
      message,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
