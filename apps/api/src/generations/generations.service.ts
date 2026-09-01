/** 实现 generation 幂等创建、用户授权查询、取消和重试状态管理。 */

import type {
  CreateConversationGenerationRequest,
  CreateGenerationRequest,
  CreateGenerationResponse,
  GenerationResponse,
  GenerationAttemptListResponse,
  MessageResponse,
} from '@chat/contracts';
import {
  GenerationStatus,
  MessageRole,
  MessageStatus,
  Prisma,
} from '@chat/database';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ApiEnv } from '@chat/config';
import { API_ENV } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { ApiException } from '../http/api-exception';

const CREATABLE_STATUSES = [
  GenerationStatus.QUEUED,
  GenerationStatus.STARTING,
  GenerationStatus.STREAMING,
] as const;

const ACTIVE_STATUSES = [
  ...CREATABLE_STATUSES,
  GenerationStatus.CANCEL_REQUESTED,
] as const;

@Injectable()
export class GenerationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_ENV) private readonly environment: ApiEnv,
  ) {}

  /**
   * 幂等创建消息、generation 与 enqueue Outbox；同一事务保证任务记录和入队意图一致。
   */
  /** 在单事务中写入消息、generation 与 Outbox，并按请求摘要保证幂等。 */
  async create(
    userId: string,
    conversationId: string,
    idempotencyKey: string,
    request: CreateGenerationRequest,
  ): Promise<CreateGenerationResponse> {
    const requestHash = this.hashRequest(conversationId, request);
    const existing = await this.findByIdempotencyKey(userId, idempotencyKey);
    if (existing) return this.resolveExisting(existing, requestHash);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        /**
         * 用户级事务锁串行化并发计数，避免多个创建请求同时突破 generation 上限。
         */
        await transaction.$queryRaw`
          SELECT pg_advisory_xact_lock(hashtext(${userId})) IS NULL AS locked
        `;
        const conversation = await transaction.conversation.findFirst({
          where: { id: conversationId, ownerUserId: userId },
          select: { id: true },
        });
        if (!conversation) this.notFound('对话不存在');
        const activeCount = await transaction.generation.count({
          where: { userId, status: { in: [...ACTIVE_STATUSES] } },
        });
        if (activeCount >= this.environment.USER_GENERATION_CONCURRENCY_LIMIT) {
          throw new ApiException(
            'USER_CONCURRENCY_LIMIT',
            `同时最多运行 ${this.environment.USER_GENERATION_CONCURRENCY_LIMIT} 个生成任务`,
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        const now = new Date();
        const userMessage = await transaction.message.create({
          data: {
            id: request.clientMessageId,
            conversationId,
            authorUserId: userId,
            role: MessageRole.USER,
            status: MessageStatus.COMPLETED,
            content: request.content,
            completedAt: now,
          },
        });
        const assistantMessage = await transaction.message.create({
          data: {
            conversationId,
            role: MessageRole.ASSISTANT,
            status: MessageStatus.PENDING,
            content: '',
          },
        });
        const generation = await transaction.generation.create({
          data: {
            userId,
            conversationId,
            requestMessageId: userMessage.id,
            responseMessageId: assistantMessage.id,
            provider: this.environment.LLM_PROVIDER,
            model: this.environment.LLM_DEFAULT_MODEL,
            idempotencyKey,
            requestHash,
          },
        });
        await transaction.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: now },
        });
        /**
         * Outbox 与业务数据一同提交，dispatcher 可在 API 崩溃后继续可靠投递任务。
         */
        await transaction.outboxEvent.create({
          data: {
            aggregateType: 'generation',
            aggregateId: generation.id,
            type: 'generation.enqueue',
            payload: { generationId: generation.id },
          },
        });
        return {
          conversation: { id: conversationId },
          userMessage: this.toMessage(userMessage),
          assistantMessage: this.toMessage(assistantMessage),
          generation: this.toGeneration(generation),
        };
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        const raced = await this.findByIdempotencyKey(userId, idempotencyKey);
        if (raced) return this.resolveExisting(raced, requestHash);
        throw new ApiException(
          'CLIENT_MESSAGE_ID_REUSED',
          '客户端消息 ID 已被使用',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async get(userId: string, generationId: string): Promise<GenerationResponse> {
    const generation = await this.prisma.generation.findFirst({
      where: { id: generationId, userId },
    });
    if (!generation) this.notFound('Generation 不存在');
    return this.toGeneration(generation);
  }

  /** 通过条件状态转换请求取消，终态任务保持不可变。 */
  async cancel(
    userId: string,
    generationId: string,
  ): Promise<GenerationResponse> {
    const scoped = await this.prisma.generation.findFirst({
      where: { id: generationId, userId },
      select: { id: true },
    });
    if (!scoped) this.notFound('Generation 不存在');

    await this.prisma.generation.updateMany({
      where: {
        id: generationId,
        userId,
        status: { in: [...CREATABLE_STATUSES] },
      },
      data: {
        status: GenerationStatus.CANCEL_REQUESTED,
        cancelRequestedAt: new Date(),
      },
    });
    return this.get(userId, generationId);
  }

  async attempts(
    userId: string,
    generationId: string,
  ): Promise<GenerationAttemptListResponse> {
    const generation = await this.prisma.generation.findFirst({
      where: { id: generationId, userId },
      select: {
        id: true,
        attempts: { orderBy: { attemptNo: 'asc' } },
      },
    });
    if (!generation) this.notFound('Generation 不存在');
    return {
      generationId: generation.id,
      attempts: generation.attempts.map((attempt) => ({
        id: attempt.id,
        generationId: attempt.generationId,
        attemptNo: attempt.attemptNo,
        status: attempt.status,
        providerRequestId: attempt.providerRequestId,
        receivedFirstDelta: attempt.receivedFirstDelta,
        httpStatus: attempt.httpStatus,
        errorCode: attempt.errorCode,
        startedAt: attempt.startedAt.toISOString(),
        endedAt: attempt.endedAt?.toISOString() ?? null,
      })),
    };
  }

  /** 为失败 generation 创建新任务，保留原任务及尝试记录作为审计事实。 */
  async retry(
    userId: string,
    sourceGenerationId: string,
    idempotencyKey: string,
  ): Promise<CreateGenerationResponse> {
    const existing = await this.findByIdempotencyKey(userId, idempotencyKey);
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ sourceGenerationId }))
      .digest('hex');
    if (existing) return this.resolveExisting(existing, requestHash);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT pg_advisory_xact_lock(hashtext(${userId})) IS NULL AS locked
        `;
        const source = await transaction.generation.findFirst({
          where: { id: sourceGenerationId, userId },
          include: { requestMessage: true, responseMessage: true },
        });
        if (!source) this.notFound('Generation 不存在');
        if (
          source.status !== GenerationStatus.FAILED &&
          source.status !== GenerationStatus.CANCELLED
        ) {
          throw new ApiException(
            'GENERATION_NOT_RETRYABLE',
            '只有失败或已取消的任务可以重试',
            HttpStatus.CONFLICT,
          );
        }
        const activeCount = await transaction.generation.count({
          where: { userId, status: { in: [...ACTIVE_STATUSES] } },
        });
        if (activeCount >= this.environment.USER_GENERATION_CONCURRENCY_LIMIT) {
          throw new ApiException(
            'USER_CONCURRENCY_LIMIT',
            `同时最多运行 ${this.environment.USER_GENERATION_CONCURRENCY_LIMIT} 个生成任务`,
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        const now = new Date();
        const userMessage = await transaction.message.create({
          data: {
            conversationId: source.conversationId,
            authorUserId: userId,
            role: MessageRole.USER,
            status: MessageStatus.COMPLETED,
            content: source.requestMessage.content,
            parentMessageId: source.requestMessageId,
            completedAt: now,
          },
        });
        const assistantMessage = await transaction.message.create({
          data: {
            conversationId: source.conversationId,
            role: MessageRole.ASSISTANT,
            status: MessageStatus.PENDING,
            content: '',
            parentMessageId: source.responseMessageId,
          },
        });
        const generation = await transaction.generation.create({
          data: {
            userId,
            conversationId: source.conversationId,
            requestMessageId: userMessage.id,
            responseMessageId: assistantMessage.id,
            provider: this.environment.LLM_PROVIDER,
            model: this.environment.LLM_DEFAULT_MODEL,
            idempotencyKey,
            requestHash,
          },
        });
        await transaction.conversation.update({
          where: { id: source.conversationId },
          data: { lastMessageAt: now },
        });
        await transaction.outboxEvent.create({
          data: {
            aggregateType: 'generation',
            aggregateId: generation.id,
            type: 'generation.enqueue',
            payload: { generationId: generation.id },
          },
        });
        return {
          conversation: { id: source.conversationId },
          userMessage: this.toMessage(userMessage),
          assistantMessage: this.toMessage(assistantMessage),
          generation: this.toGeneration(generation),
        };
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        const raced = await this.findByIdempotencyKey(userId, idempotencyKey);
        if (raced) return this.resolveExisting(raced, requestHash);
      }
      throw error;
    }
  }

  private async findByIdempotencyKey(userId: string, idempotencyKey: string) {
    return this.prisma.generation.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      include: { requestMessage: true, responseMessage: true },
    });
  }

  /** 同一幂等键仅在请求摘要一致时复用，否则明确报告冲突。 */
  private resolveExisting(
    existing: NonNullable<
      Awaited<ReturnType<GenerationsService['findByIdempotencyKey']>>
    >,
    requestHash: string,
  ): CreateGenerationResponse {
    if (existing.requestHash !== requestHash) {
      throw new ApiException(
        'IDEMPOTENCY_KEY_REUSED',
        '幂等键已用于其他请求',
        HttpStatus.CONFLICT,
      );
    }
    return {
      conversation: { id: existing.conversationId },
      userMessage: this.toMessage(existing.requestMessage),
      assistantMessage: this.toMessage(existing.responseMessage),
      generation: this.toGeneration(existing),
    };
  }

  /** 对影响创建语义的规范化字段生成稳定摘要，用于检测幂等键误用。 */
  private hashRequest(
    conversationId: string,
    request: CreateGenerationRequest,
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          conversationId,
          clientMessageId: request.clientMessageId,
          content: request.content,
        }),
      )
      .digest('hex');
  }

  private toMessage(message: {
    id: string;
    conversationId: string;
    role: MessageRole;
    status: MessageStatus;
    content: string;
    reasoningContent: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }): MessageResponse {
    return {
      id: message.id,
      conversationId: message.conversationId,
      role: message.role,
      status: message.status,
      content: message.content,
      reasoningContent: message.reasoningContent,
      createdAt: message.createdAt.toISOString(),
      completedAt: message.completedAt?.toISOString() ?? null,
    };
  }

  private toGeneration(generation: {
    id: string;
    conversationId: string;
    requestMessageId: string;
    responseMessageId: string;
    provider: string;
    model: string;
    status: GenerationStatus;
    lastSequence: bigint;
    finishReason: string | null;
    errorCode: string | null;
    errorDetailSafe: string | null;
    cancelRequestedAt: Date | null;
    startedAt: Date | null;
    firstTokenAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): GenerationResponse {
    return {
      id: generation.id,
      conversationId: generation.conversationId,
      requestMessageId: generation.requestMessageId,
      responseMessageId: generation.responseMessageId,
      provider: generation.provider,
      model: generation.model,
      status: generation.status,
      lastSequence: Number(generation.lastSequence),
      finishReason: generation.finishReason,
      errorCode: generation.errorCode,
      errorDetailSafe: generation.errorDetailSafe,
      cancelRequestedAt: generation.cancelRequestedAt?.toISOString() ?? null,
      startedAt: generation.startedAt?.toISOString() ?? null,
      firstTokenAt: generation.firstTokenAt?.toISOString() ?? null,
      completedAt: generation.completedAt?.toISOString() ?? null,
      createdAt: generation.createdAt.toISOString(),
      updatedAt: generation.updatedAt.toISOString(),
    };
  }

  private isUniqueConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private notFound(message: string): never {
    throw new ApiException('NOT_FOUND', message, HttpStatus.NOT_FOUND);
  }

  /** 原子创建对话、首条消息、Generation 与入队 Outbox。 */
  async createConversationWithGeneration(
    userId: string,
    idempotencyKey: string,
    request: CreateConversationGenerationRequest,
  ): Promise<CreateGenerationResponse> {
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          operation: 'create-conversation-generation',
          title: request.title,
          content: request.content,
          clientMessageId: request.clientMessageId,
        }),
      )
      .digest('hex');
    const existing = await this.findByIdempotencyKey(userId, idempotencyKey);
    if (existing) return this.resolveExisting(existing, requestHash);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT pg_advisory_xact_lock(hashtext(${userId})) IS NULL AS locked
        `;
        const activeCount = await transaction.generation.count({
          where: { userId, status: { in: [...ACTIVE_STATUSES] } },
        });
        if (activeCount >= this.environment.USER_GENERATION_CONCURRENCY_LIMIT) {
          throw new ApiException(
            'USER_CONCURRENCY_LIMIT',
            `同时最多运行 ${this.environment.USER_GENERATION_CONCURRENCY_LIMIT} 个生成任务`,
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        const now = new Date();
        const conversation = await transaction.conversation.create({
          data: {
            ownerUserId: userId,
            title: request.title,
            lastMessageAt: now,
            userStates: { create: { userId, lastReadAt: now } },
          },
        });
        const userMessage = await transaction.message.create({
          data: {
            id: request.clientMessageId,
            conversationId: conversation.id,
            authorUserId: userId,
            role: MessageRole.USER,
            status: MessageStatus.COMPLETED,
            content: request.content,
            completedAt: now,
          },
        });
        const assistantMessage = await transaction.message.create({
          data: {
            conversationId: conversation.id,
            role: MessageRole.ASSISTANT,
            status: MessageStatus.PENDING,
            content: '',
          },
        });
        const generation = await transaction.generation.create({
          data: {
            userId,
            conversationId: conversation.id,
            requestMessageId: userMessage.id,
            responseMessageId: assistantMessage.id,
            provider: this.environment.LLM_PROVIDER,
            model: this.environment.LLM_DEFAULT_MODEL,
            idempotencyKey,
            requestHash,
          },
        });
        await transaction.outboxEvent.create({
          data: {
            aggregateType: 'generation',
            aggregateId: generation.id,
            type: 'generation.enqueue',
            payload: { generationId: generation.id },
          },
        });
        return {
          conversation: { id: conversation.id },
          userMessage: this.toMessage(userMessage),
          assistantMessage: this.toMessage(assistantMessage),
          generation: this.toGeneration(generation),
        };
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        const raced = await this.findByIdempotencyKey(userId, idempotencyKey);
        if (raced) return this.resolveExisting(raced, requestHash);
        throw new ApiException(
          'CLIENT_MESSAGE_ID_REUSED',
          '客户端消息 ID 已被使用',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }
}
