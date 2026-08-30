/** 暴露按当前用户隔离的对话、消息、归档和阅读状态 REST 接口。 */

import {
  createConversationRequestSchema,
  createMessageRequestSchema,
  renameConversationRequestSchema,
  updateScrollPositionRequestSchema,
  type CreateConversationRequest,
  type CreateMessageRequest,
  type RenameConversationRequest,
  type UpdateScrollPositionRequest,
} from '@chat/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ApiException } from '../http/api-exception';
import { ZodBodyPipe } from '../http/zod-body.pipe';
import { ConversationsService } from './conversations.service';

const idSchema = z.string().uuid();
const listQuerySchema = z.object({
  archived: z.enum(['true', 'false']).optional().default('false'),
});
const messageQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Post()
  create(
    @Req() request: Request,
    @Body(new ZodBodyPipe(createConversationRequestSchema))
    body: CreateConversationRequest,
  ) {
    return this.conversations.create(this.userId(request), body.title);
  }

  @Get()
  list(@Req() request: Request, @Query() query: unknown) {
    const parsed = this.parseQuery(listQuerySchema, query);
    return this.conversations.list(
      this.userId(request),
      parsed.archived === 'true',
    );
  }

  @Get(':conversationId')
  get(@Req() request: Request, @Param('conversationId') id: string) {
    return this.conversations.get(this.userId(request), this.id(id));
  }

  @Patch(':conversationId')
  rename(
    @Req() request: Request,
    @Param('conversationId') id: string,
    @Body(new ZodBodyPipe(renameConversationRequestSchema))
    body: RenameConversationRequest,
  ) {
    return this.conversations.rename(
      this.userId(request),
      this.id(id),
      body.title,
    );
  }

  @Post(':conversationId/archive')
  @HttpCode(HttpStatus.OK)
  archive(@Req() request: Request, @Param('conversationId') id: string) {
    return this.conversations.archive(this.userId(request), this.id(id));
  }

  @Post(':conversationId/restore')
  @HttpCode(HttpStatus.OK)
  restore(@Req() request: Request, @Param('conversationId') id: string) {
    return this.conversations.restore(this.userId(request), this.id(id));
  }

  @Delete(':conversationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Req() request: Request, @Param('conversationId') id: string) {
    await this.conversations.delete(
      this.userId(request),
      this.id(id),
      request.requestId ?? 'unknown',
    );
  }

  @Post(':conversationId/read')
  @HttpCode(HttpStatus.OK)
  markRead(@Req() request: Request, @Param('conversationId') id: string) {
    return this.conversations.markRead(this.userId(request), this.id(id));
  }

  @Put(':conversationId/scroll-position')
  updateScrollPosition(
    @Req() request: Request,
    @Param('conversationId') id: string,
    @Body(new ZodBodyPipe(updateScrollPositionRequestSchema))
    body: UpdateScrollPositionRequest,
  ) {
    return this.conversations.updateScrollPosition(
      this.userId(request),
      this.id(id),
      body.scrollOffset,
    );
  }

  @Post(':conversationId/messages')
  createMessage(
    @Req() request: Request,
    @Param('conversationId') id: string,
    @Body(new ZodBodyPipe(createMessageRequestSchema))
    body: CreateMessageRequest,
  ) {
    return this.conversations.createMessages(
      this.userId(request),
      this.id(id),
      body.content,
    );
  }

  @Get(':conversationId/messages')
  listMessages(
    @Req() request: Request,
    @Param('conversationId') id: string,
    @Query() query: unknown,
  ) {
    const parsed = this.parseQuery(messageQuerySchema, query);
    return this.conversations.listMessages(
      this.userId(request),
      this.id(id),
      parsed.limit,
      parsed.cursor,
    );
  }

  private userId(request: Request): string {
    return request.auth!.userId;
  }

  private id(value: string): string {
    const result = idSchema.safeParse(value);
    if (!result.success) this.validationError();
    return result.data;
  }

  private parseQuery<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) this.validationError();
    return result.data;
  }

  private validationError(): never {
    throw new ApiException(
      'VALIDATION_ERROR',
      '请求参数不合法',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
