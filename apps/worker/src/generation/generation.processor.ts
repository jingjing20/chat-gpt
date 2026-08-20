import type { WorkerEnv } from '@chat/config';
import {
  GenerationAttemptStatus,
  GenerationStatus,
  MessageRole,
  MessageStatus,
  Prisma,
} from '@chat/database';
import {
  ProviderError,
  type LlmProviderAdapter,
  type NormalizedChatMessage,
  type NormalizedUsage,
} from '@chat/llm';
import { metrics } from '@chat/observability';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { WORKER_ENV } from '../config/worker-config';
import { PrismaService } from '../database/prisma.service';
import { LLM_PROVIDER_ADAPTER } from './generation.constants';
import { EventPublisherService } from '../events/event-publisher.service';
import {
  GenerationReliabilityService,
  type GenerationPermit,
} from './generation-reliability.service';
import {
  createConfiguredModelProfile,
  fitMessagesToContextWindow,
} from './context-window';

const TERMINAL_STATUSES = [
  GenerationStatus.COMPLETED,
  GenerationStatus.FAILED,
  GenerationStatus.CANCELLED,
] as const;

@Injectable()
export class GenerationProcessor {
  private readonly logger = new Logger(GenerationProcessor.name);
  private readonly fallbackSequences = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER_ADAPTER)
    private readonly provider: LlmProviderAdapter,
    @Inject(WORKER_ENV) private readonly environment: WorkerEnv,
    private readonly events?: EventPublisherService,
    @Optional() private readonly reliability?: GenerationReliabilityService,
  ) {}

  async process(generationId: string): Promise<void> {
    const candidate = await this.withDatabaseRetry(() =>
      this.prisma.generation.findUnique({
        where: { id: generationId },
        select: { id: true, userId: true, provider: true, status: true },
      }),
    );
    if (!candidate || TERMINAL_STATUSES.includes(candidate.status as never))
      return;
    if (candidate.status === GenerationStatus.CANCEL_REQUESTED) {
      await this.processOwned(generationId, '');
      return;
    }
    if (candidate.status !== GenerationStatus.QUEUED) return;

    const writerToken = randomUUID();
    let permit: GenerationPermit | null = null;
    if (this.reliability) {
      permit = await this.reliability.acquire({
        generationId,
        userId: candidate.userId,
        provider: candidate.provider,
        token: writerToken,
      });
      if (!permit) throw new Error('GENERATION_CAPACITY_UNAVAILABLE');
    }
    const claimed = await this.withDatabaseRetry(() =>
      this.prisma.generation.updateMany({
        where: {
          id: generationId,
          status: GenerationStatus.QUEUED,
          writerToken: null,
        },
        data: {
          status: GenerationStatus.STARTING,
          startedAt: new Date(),
          writerToken,
          writerHeartbeatAt: new Date(),
        },
      }),
    );
    if (claimed.count === 0) {
      if (permit && this.reliability) await this.reliability.release(permit);
      return;
    }

    let heartbeatRunning = false;
    let ownershipLost = false;
    const heartbeat = setInterval(() => {
      if (heartbeatRunning) return;
      heartbeatRunning = true;
      void this.heartbeat(generationId, writerToken, permit)
        .then((owned) => {
          if (!owned) ownershipLost = true;
        })
        .finally(() => {
          heartbeatRunning = false;
        });
    }, this.environment.GENERATION_HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();
    try {
      await this.processOwned(generationId, writerToken, () => ownershipLost);
    } finally {
      clearInterval(heartbeat);
      if (permit && this.reliability) {
        try {
          await this.reliability.release(permit);
        } catch {
          this.logger.warn(`并发许可释放失败 generationId=${generationId}`);
        }
      }
    }
  }

  private async processOwned(
    generationId: string,
    writerToken: string,
    ownershipLost: () => boolean = () => false,
  ): Promise<void> {
    const generation = await this.prisma.generation.findUnique({
      where: { id: generationId },
    });
    if (!generation) return;
    const currentStatus = generation.status;
    if (TERMINAL_STATUSES.some((status) => status === currentStatus)) return;
    if (generation.status === GenerationStatus.CANCEL_REQUESTED) {
      await this.finalizeCancelled(
        generationId,
        '',
        '',
        Number(generation.lastSequence),
      );
      return;
    }
    if (generation.status !== GenerationStatus.STARTING) {
      return;
    }
    if (writerToken && generation.writerToken !== writerToken) return;

    const rawMessages = await this.loadContext(
      generation.conversationId,
      generation.responseMessageId,
    );
    const modelProfile = createConfiguredModelProfile({
      provider: generation.provider,
      model: generation.model,
      contextWindow: this.environment.LLM_CONTEXT_WINDOW,
      maxOutputTokens: this.environment.LLM_MAX_OUTPUT_TOKENS,
      reasoningEnabled: this.environment.LLM_REASONING_MODE === 'enabled',
    });
    const context = fitMessagesToContextWindow(rawMessages, modelProfile);
    const messages = context.messages;
    if (context.droppedMessageCount > 0) {
      this.logger.log(
        `上下文已裁剪 generationId=${generationId} droppedMessages=${context.droppedMessageCount} truncatedMessages=${context.truncatedMessageCount} estimatedInputTokens=${context.estimatedInputTokens}`,
      );
    }
    await this.prisma.generationAttempt.updateMany({
      where: { generationId, status: GenerationAttemptStatus.STARTED },
      data: {
        status: GenerationAttemptStatus.FAILED,
        endedAt: new Date(),
        errorCode: 'WORKER_INTERRUPTED',
      },
    });
    const initialAttemptCount = await this.prisma.generationAttempt.count({
      where: { generationId },
    });
    const checkpointMessage = await this.prisma.message.findUniqueOrThrow({
      where: { id: generation.responseMessageId },
      select: { content: true, reasoningContent: true },
    });
    let content = checkpointMessage.content;
    let reasoningContent = checkpointMessage.reasoningContent ?? '';
    let sequence = Number(generation.lastSequence);
    let lastCheckpointAt = Date.now();
    let lastCheckpointChars = content.length + reasoningContent.length;

    if (initialAttemptCount >= this.environment.GENERATION_MAX_ATTEMPTS) {
      await this.finalizeFailed({
        generationId,
        userId: generation.userId,
        conversationId: generation.conversationId,
        responseMessageId: generation.responseMessageId,
        content,
        reasoningContent,
        sequence,
        error: new ProviderError({
          code: 'UNKNOWN',
          retryableBeforeFirstDelta: false,
          safeMessage: '生成任务重试次数已耗尽',
        }),
        provider: generation.provider,
        model: generation.model,
      });
      return;
    }

    for (
      let attemptNo = initialAttemptCount + 1;
      attemptNo <= this.environment.GENERATION_MAX_ATTEMPTS;
      attemptNo += 1
    ) {
      if (await this.isCancellationRequested(generationId)) {
        await this.finalizeCancelled(
          generationId,
          content,
          reasoningContent,
          sequence,
        );
        return;
      }
      const controller = new AbortController();
      let cancelObserved = false;
      let cancellationCheckRunning = false;
      const cancelTimer = setInterval(() => {
        if (cancellationCheckRunning) return;
        cancellationCheckRunning = true;
        void this.isCancellationRequested(generationId)
          .then((requested) => {
            if (requested) {
              cancelObserved = true;
              controller.abort(new DOMException('任务已取消', 'AbortError'));
            }
          })
          .finally(() => {
            cancellationCheckRunning = false;
          });
      }, this.environment.GENERATION_CANCEL_POLL_MS);
      cancelTimer.unref();

      const attempt = await this.prisma.generationAttempt.create({
        data: { generationId, attemptNo, writerToken: writerToken || null },
      });
      sequence = await this.publishEvent(
        generation,
        'generation.started',
        {
          attempt: attemptNo,
        },
        content,
        reasoningContent,
        'STARTING',
      );
      await this.writeCheckpoint({
        generationId,
        responseMessageId: generation.responseMessageId,
        content,
        reasoningContent,
        sequence,
      });
      lastCheckpointAt = Date.now();
      lastCheckpointChars = content.length + reasoningContent.length;
      let receivedFirstDelta = false;
      let usage: NormalizedUsage | undefined;
      let finishReason: string | null = null;
      let providerRequestId: string | null = null;
      let bufferedType: 'message.delta' | 'message.reasoning_delta' | null =
        null;
      let bufferedDelta = '';
      let lastFlushAt = Date.now();
      const flushDelta = async () => {
        if (!bufferedType || !bufferedDelta) return;
        sequence = await this.publishEvent(
          generation,
          bufferedType,
          { delta: bufferedDelta },
          content,
          reasoningContent,
          'STREAMING',
        );
        const currentChars = content.length + reasoningContent.length;
        if (
          Date.now() - lastCheckpointAt >=
            this.environment.GENERATION_CHECKPOINT_INTERVAL_MS ||
          currentChars - lastCheckpointChars >=
            this.environment.GENERATION_CHECKPOINT_MAX_CHARS
        ) {
          await this.writeCheckpoint({
            generationId,
            responseMessageId: generation.responseMessageId,
            content,
            reasoningContent,
            sequence,
          });
          lastCheckpointAt = Date.now();
          lastCheckpointChars = currentChars;
        }
        bufferedType = null;
        bufferedDelta = '';
        lastFlushAt = Date.now();
      };
      const bufferDelta = async (
        type: 'message.delta' | 'message.reasoning_delta',
        delta: string,
      ) => {
        if (bufferedType && bufferedType !== type) await flushDelta();
        bufferedType = type;
        bufferedDelta += delta;
        if (
          bufferedDelta.length >= this.environment.GENERATION_DELTA_MAX_CHARS ||
          Date.now() - lastFlushAt >= this.environment.GENERATION_DELTA_FLUSH_MS
        ) {
          await flushDelta();
        }
      };

      try {
        for await (const event of this.provider.streamChat(
          {
            model: generation.model,
            messages,
            maxOutputTokens: modelProfile.maxOutputTokens,
            reasoning: {
              enabled: this.environment.LLM_REASONING_MODE === 'enabled',
              effort: this.environment.LLM_REASONING_EFFORT,
            },
            userId: this.providerUserId(generation.userId),
          },
          controller.signal,
        )) {
          if (ownershipLost()) {
            controller.abort(
              new DOMException('Writer 所有权已丢失', 'AbortError'),
            );
            throw new Error('WRITER_OWNERSHIP_LOST');
          }
          if (event.type === 'content_delta') {
            content += event.delta;
            if (!receivedFirstDelta) {
              receivedFirstDelta = true;
              await this.markStreaming(
                generationId,
                generation.responseMessageId,
              );
            }
            await bufferDelta('message.delta', event.delta);
          } else if (event.type === 'reasoning_delta') {
            reasoningContent += event.delta;
            if (!receivedFirstDelta) {
              receivedFirstDelta = true;
              await this.markStreaming(
                generationId,
                generation.responseMessageId,
              );
            }
            await bufferDelta('message.reasoning_delta', event.delta);
          } else if (event.type === 'usage') {
            usage = event.usage;
          } else {
            finishReason = event.finishReason;
            providerRequestId = event.providerRequestId ?? null;
          }
        }
        await flushDelta();

        if (
          cancelObserved ||
          (await this.isCancellationRequested(generationId))
        ) {
          await this.completeAttempt(
            attempt.id,
            GenerationAttemptStatus.CANCELLED,
            receivedFirstDelta,
          );
          await this.finalizeCancelled(
            generationId,
            content,
            reasoningContent,
            sequence,
          );
          return;
        }
        await this.completeAttempt(
          attempt.id,
          GenerationAttemptStatus.COMPLETED,
          receivedFirstDelta,
          undefined,
          providerRequestId,
        );
        if (usage) {
          sequence = await this.publishEvent(
            generation,
            'generation.usage',
            { ...usage },
            content,
            reasoningContent,
            'STREAMING',
          );
        }
        const finalized = await this.finalizeCompleted({
          generationId,
          userId: generation.userId,
          conversationId: generation.conversationId,
          responseMessageId: generation.responseMessageId,
          content,
          reasoningContent,
          sequence,
          finishReason,
          providerRequestId,
          usage,
          provider: generation.provider,
          model: generation.model,
        });
        if (!finalized) return;
        sequence = await this.publishEvent(
          generation,
          'generation.completed',
          { finishReason, finalContentHash: this.contentHash(content) },
          content,
          reasoningContent,
          'COMPLETED',
        );
        await this.updateLastSequence(generationId, sequence);
        return;
      } catch (error) {
        await flushDelta();
        if (
          cancelObserved ||
          (await this.isCancellationRequested(generationId))
        ) {
          await this.completeAttempt(
            attempt.id,
            GenerationAttemptStatus.CANCELLED,
            receivedFirstDelta,
          );
          await this.finalizeCancelled(
            generationId,
            content,
            reasoningContent,
            sequence,
          );
          return;
        }
        const normalized = this.normalizeError(error, receivedFirstDelta);
        metrics.increment('chat_generation_provider_errors_total', {
          code: normalized.code,
          provider: generation.provider,
        });
        if (
          normalized.code === 'AUTHENTICATION_FAILED' ||
          normalized.code === 'INSUFFICIENT_BALANCE'
        ) {
          this.logger.error(
            `高优供应商告警 generationId=${generationId} attemptNo=${attemptNo} provider=${generation.provider} code=${normalized.code}`,
          );
        }
        await this.completeAttempt(
          attempt.id,
          GenerationAttemptStatus.FAILED,
          receivedFirstDelta,
          normalized,
        );
        const canRetry =
          !receivedFirstDelta &&
          normalized.retryableBeforeFirstDelta &&
          attemptNo < this.environment.GENERATION_MAX_ATTEMPTS;
        if (canRetry) {
          await this.retryDelay(attemptNo);
          continue;
        }
        const finalized = await this.finalizeFailed({
          generationId,
          userId: generation.userId,
          conversationId: generation.conversationId,
          responseMessageId: generation.responseMessageId,
          content,
          reasoningContent,
          sequence,
          error: normalized,
          usage,
          provider: generation.provider,
          model: generation.model,
        });
        if (!finalized) return;
        sequence = await this.publishEvent(
          generation,
          'generation.failed',
          {
            code: normalized.code,
            retryable: normalized.retryableBeforeFirstDelta,
            safeMessage: normalized.message,
          },
          content,
          reasoningContent,
          'FAILED',
        );
        await this.updateLastSequence(generationId, sequence);
        return;
      } finally {
        clearInterval(cancelTimer);
        controller.abort();
      }
    }
  }

  private async publishEvent(
    generation: {
      userId: string;
      conversationId: string;
      id: string;
      responseMessageId: string;
    },
    type: Parameters<EventPublisherService['publish']>[0]['type'],
    payload: Record<string, unknown>,
    content: string,
    reasoningContent: string,
    status: string,
  ): Promise<number> {
    if (!this.events) {
      const next = (this.fallbackSequences.get(generation.id) ?? 0) + 1;
      this.fallbackSequences.set(generation.id, next);
      return next;
    }
    const event = await this.events.publish({
      userId: generation.userId,
      conversationId: generation.conversationId,
      generationId: generation.id,
      messageId: generation.responseMessageId,
      type,
      payload,
      state: { content, reasoningContent: reasoningContent || null, status },
    });
    return event.sequence;
  }

  private contentHash(content: string): string {
    return createHmac('sha256', this.environment.LLM_USER_HASH_SECRET)
      .update(content)
      .digest('hex');
  }

  private async updateLastSequence(
    generationId: string,
    sequence: number,
  ): Promise<void> {
    await this.prisma.generation.updateMany({
      where: { id: generationId, checkpointSequence: { lt: sequence } },
      data: { lastSequence: sequence, checkpointSequence: sequence },
    });
  }

  private async writeCheckpoint(input: {
    generationId: string;
    responseMessageId: string;
    content: string;
    reasoningContent: string;
    sequence: number;
  }): Promise<void> {
    await this.withDatabaseRetry(() =>
      this.prisma.$transaction(async (transaction) => {
        const advanced = await transaction.generation.updateMany({
          where: {
            id: input.generationId,
            checkpointSequence: { lt: input.sequence },
            status: {
              in: [GenerationStatus.STARTING, GenerationStatus.STREAMING],
            },
          },
          data: {
            lastSequence: input.sequence,
            checkpointSequence: input.sequence,
          },
        });
        if (advanced.count === 0) return;
        await transaction.message.update({
          where: { id: input.responseMessageId },
          data: {
            content: input.content,
            reasoningContent: this.savedReasoning(input.reasoningContent),
          },
        });
      }),
    );
  }

  private async loadContext(
    conversationId: string,
    responseMessageId: string,
  ): Promise<NormalizedChatMessage[]> {
    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        id: { not: responseMessageId },
        status: MessageStatus.COMPLETED,
        role: {
          in: [MessageRole.SYSTEM, MessageRole.USER, MessageRole.ASSISTANT],
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { role: true, content: true },
    });
    return messages.map((message) => ({
      role: message.role.toLowerCase() as NormalizedChatMessage['role'],
      content: message.content,
    }));
  }

  private async markStreaming(
    generationId: string,
    responseMessageId: string,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.generation.updateMany({
        where: { id: generationId, status: GenerationStatus.STARTING },
        data: { status: GenerationStatus.STREAMING, firstTokenAt: now },
      }),
      this.prisma.message.updateMany({
        where: { id: responseMessageId, status: MessageStatus.PENDING },
        data: { status: MessageStatus.STREAMING },
      }),
    ]);
  }

  private async completeAttempt(
    attemptId: string,
    status: GenerationAttemptStatus,
    receivedFirstDelta: boolean,
    error?: ProviderError,
    providerRequestId?: string | null,
  ): Promise<void> {
    await this.withDatabaseRetry(() =>
      this.prisma.generationAttempt.update({
        where: { id: attemptId },
        data: {
          status,
          endedAt: new Date(),
          receivedFirstDelta,
          providerRequestId: providerRequestId ?? null,
          httpStatus: error?.httpStatus ?? null,
          errorCode: error?.code ?? null,
        },
      }),
    );
  }

  private async finalizeCompleted(input: FinalizeInput): Promise<boolean> {
    const now = new Date();
    const finalized = await this.prisma.$transaction(async (transaction) => {
      const transitioned = await transaction.generation.updateMany({
        where: {
          id: input.generationId,
          status: {
            in: [GenerationStatus.STARTING, GenerationStatus.STREAMING],
          },
        },
        data: {
          status: GenerationStatus.COMPLETED,
          lastSequence: input.sequence,
          checkpointSequence: input.sequence,
          finishReason: input.finishReason,
          providerRequestId: input.providerRequestId,
          completedAt: now,
        },
      });
      if (transitioned.count === 0) return false;
      await transaction.message.update({
        where: { id: input.responseMessageId },
        data: {
          status: MessageStatus.COMPLETED,
          content: input.content,
          reasoningContent: this.savedReasoning(input.reasoningContent),
          completedAt: now,
        },
      });
      await transaction.conversationUserState.update({
        where: {
          conversationId_userId: {
            conversationId: input.conversationId,
            userId: input.userId,
          },
        },
        data: { hasUnread: true },
      });
      if (input.usage) await this.createUsage(transaction, input, input.usage);
      return true;
    });
    if (await this.isCancellationRequested(input.generationId)) {
      await this.finalizeCancelled(
        input.generationId,
        input.content,
        input.reasoningContent,
        input.sequence,
      );
    }
    return finalized;
  }

  private async finalizeFailed(input: FailureInput): Promise<boolean> {
    const now = new Date();
    const finalized = await this.prisma.$transaction(async (transaction) => {
      const transitioned = await transaction.generation.updateMany({
        where: {
          id: input.generationId,
          status: {
            in: [GenerationStatus.STARTING, GenerationStatus.STREAMING],
          },
        },
        data: {
          status: GenerationStatus.FAILED,
          lastSequence: input.sequence,
          checkpointSequence: input.sequence,
          errorCode: input.error.code,
          errorDetailSafe: input.error.message,
          completedAt: now,
        },
      });
      if (transitioned.count === 0) return false;
      await transaction.message.update({
        where: { id: input.responseMessageId },
        data: {
          status: MessageStatus.FAILED,
          content: input.content,
          reasoningContent: this.savedReasoning(input.reasoningContent),
          completedAt: now,
        },
      });
      await transaction.conversationUserState.update({
        where: {
          conversationId_userId: {
            conversationId: input.conversationId,
            userId: input.userId,
          },
        },
        data: { hasUnread: true },
      });
      if (input.usage) await this.createUsage(transaction, input, input.usage);
      return true;
    });
    if (await this.isCancellationRequested(input.generationId)) {
      await this.finalizeCancelled(
        input.generationId,
        input.content,
        input.reasoningContent,
        input.sequence,
      );
    }
    return finalized;
  }

  private async finalizeCancelled(
    generationId: string,
    content: string,
    reasoningContent: string,
    sequence: number,
  ): Promise<void> {
    const generation = await this.prisma.generation.findUnique({
      where: { id: generationId },
      select: {
        id: true,
        userId: true,
        conversationId: true,
        responseMessageId: true,
        lastSequence: true,
      },
    });
    if (!generation) return;
    const now = new Date();
    const cancelled = await this.prisma.$transaction(async (transaction) => {
      const transitioned = await transaction.generation.updateMany({
        where: {
          id: generationId,
          status: {
            in: [
              GenerationStatus.QUEUED,
              GenerationStatus.STARTING,
              GenerationStatus.STREAMING,
              GenerationStatus.CANCEL_REQUESTED,
            ],
          },
        },
        data: {
          status: GenerationStatus.CANCELLED,
          lastSequence: sequence,
          checkpointSequence: sequence,
          completedAt: now,
        },
      });
      if (transitioned.count === 0) return false;
      await transaction.message.update({
        where: { id: generation.responseMessageId },
        data: {
          status: MessageStatus.CANCELLED,
          content,
          reasoningContent: this.savedReasoning(reasoningContent),
          completedAt: now,
        },
      });
      await transaction.conversationUserState.update({
        where: {
          conversationId_userId: {
            conversationId: generation.conversationId,
            userId: generation.userId,
          },
        },
        data: { hasUnread: true },
      });
      return true;
    });
    if (cancelled) {
      const lastSequence = await this.publishEvent(
        generation,
        'generation.cancelled',
        { partial: Boolean(content || reasoningContent) },
        content,
        reasoningContent,
        'CANCELLED',
      );
      await this.updateLastSequence(generationId, lastSequence);
    }
  }

  private async createUsage(
    transaction: Prisma.TransactionClient,
    input: { generationId: string; provider: string; model: string },
    usage: NormalizedUsage,
  ): Promise<void> {
    await transaction.usageRecord.create({
      data: {
        generationId: input.generationId,
        provider: input.provider,
        model: input.model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        reasoningTokens: usage.reasoningTokens,
        cacheHitTokens: usage.cacheHitTokens,
        cacheMissTokens: usage.cacheMissTokens,
      },
    });
  }

  private savedReasoning(reasoningContent: string): string | null {
    return this.environment.LLM_REASONING_MODE === 'enabled'
      ? reasoningContent || null
      : null;
  }

  private providerUserId(userId: string): string {
    return createHmac('sha256', this.environment.LLM_USER_HASH_SECRET)
      .update(userId)
      .digest('base64url');
  }

  private async isCancellationRequested(
    generationId: string,
  ): Promise<boolean> {
    const generation = await this.prisma.generation.findUnique({
      where: { id: generationId },
      select: { status: true },
    });
    return generation?.status === GenerationStatus.CANCEL_REQUESTED;
  }

  private async heartbeat(
    generationId: string,
    writerToken: string,
    permit: GenerationPermit | null,
  ): Promise<boolean> {
    try {
      if (permit && this.reliability && !(await this.reliability.renew(permit)))
        return false;
      const updated = await this.prisma.generation.updateMany({
        where: {
          id: generationId,
          writerToken,
          status: {
            in: [GenerationStatus.STARTING, GenerationStatus.STREAMING],
          },
        },
        data: { writerHeartbeatAt: new Date() },
      });
      return updated.count === 1;
    } catch {
      metrics.increment('chat_generation_heartbeat_failures_total');
      this.logger.warn(`Worker heartbeat 失败 generationId=${generationId}`);
      return true;
    }
  }

  private normalizeError(
    error: unknown,
    receivedFirstDelta: boolean,
  ): ProviderError {
    if (error instanceof ProviderError) {
      if (!receivedFirstDelta || !error.retryableBeforeFirstDelta) return error;
      return new ProviderError({
        code: error.code,
        retryableBeforeFirstDelta: false,
        safeMessage: error.message,
        ...(error.httpStatus === undefined
          ? {}
          : { httpStatus: error.httpStatus }),
        cause: error,
      });
    }
    return new ProviderError({
      code: 'UNKNOWN',
      retryableBeforeFirstDelta: false,
      safeMessage: '生成任务执行失败',
      cause: error,
    });
  }

  private async retryDelay(attemptNo: number): Promise<void> {
    const exponential =
      this.environment.GENERATION_RETRY_BASE_DELAY_MS * 2 ** (attemptNo - 1);
    const delay = Math.min(
      this.environment.GENERATION_RETRY_MAX_DELAY_MS,
      Math.floor(exponential * (0.75 + Math.random() * 0.5)),
    );
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private async withDatabaseRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!this.isTransientDatabaseError(error) || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
      }
    }
    throw lastError;
  }

  private isTransientDatabaseError(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(error.code);
    }
    return (
      error instanceof Prisma.PrismaClientInitializationError ||
      (error instanceof Error &&
        /connection|timeout|closed/i.test(error.message))
    );
  }
}

interface FinalizeInput {
  generationId: string;
  userId: string;
  conversationId: string;
  responseMessageId: string;
  content: string;
  reasoningContent: string;
  sequence: number;
  finishReason: string | null;
  providerRequestId: string | null;
  usage?: NormalizedUsage;
  provider: string;
  model: string;
}

interface FailureInput {
  generationId: string;
  userId: string;
  conversationId: string;
  responseMessageId: string;
  content: string;
  reasoningContent: string;
  sequence: number;
  error: ProviderError;
  usage?: NormalizedUsage;
  provider: string;
  model: string;
}
