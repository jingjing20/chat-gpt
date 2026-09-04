import type {
  CreateScheduledTaskRequest,
  ScheduledTaskResponse,
  ScheduledTaskStatus as ScheduledTaskStatusDto,
  UpdateScheduledTaskRequest,
} from '@chat/contracts';
import {
  MessageRole,
  MessageStatus,
  ScheduledTaskCadence,
  ScheduledTaskStatus,
} from '@chat/database';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { GenerationsService } from '../generations/generations.service';
import { ApiException } from '../http/api-exception';

export function nextScheduledRun(
  cadence: ScheduledTaskCadence,
  from: Date,
  timeOfDay?: string,
  timezoneOffsetMinutes = 0,
) {
  const next = new Date(from.getTime() + timezoneOffsetMinutes * 60_000);
  next.setUTCDate(
    next.getUTCDate() + (cadence === ScheduledTaskCadence.DAILY ? 1 : 7),
  );
  if (timeOfDay) {
    const [hours, minutes] = timeOfDay.split(':').map(Number);
    next.setUTCHours(hours, minutes, 0, 0);
  }
  return new Date(next.getTime() - timezoneOffsetMinutes * 60_000);
}

export function taskCompletionMessageTimes(now: Date) {
  return {
    answerCreatedAt: now,
    confirmationCreatedAt: new Date(now.getTime() + 1),
  };
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly generations: GenerationsService,
  ) {}

  async create(userId: string, request: CreateScheduledTaskRequest) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: request.conversationId, ownerUserId: userId },
      select: { id: true },
    });
    if (!conversation) {
      throw new ApiException('NOT_FOUND', '对话不存在', HttpStatus.NOT_FOUND);
    }
    const now = new Date();
    const task = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.scheduledTask.create({
        data: {
          userId,
          conversationId: request.conversationId,
          title: request.title,
          prompt: request.prompt,
          cadence: request.cadence,
          timeOfDay: request.timeOfDay,
          timezoneOffsetMinutes: request.timezoneOffsetMinutes,
          nextRunAt: nextScheduledRun(
            request.cadence,
            now,
            request.timeOfDay,
            request.timezoneOffsetMinutes,
          ),
        },
      });
      if (request.answers?.length) {
        const { answerCreatedAt, confirmationCreatedAt } =
          taskCompletionMessageTimes(now);
        const answerSummary = request.answers
          .map(({ question, answer }) => `> ${question}\n${answer}`)
          .join('\n\n');
        const questionnaireAnswer = await transaction.message.findFirst({
          where: {
            conversationId: request.conversationId,
            role: MessageRole.ASSISTANT,
          },
          orderBy: { createdAt: 'desc' },
        });
        if (questionnaireAnswer) {
          await transaction.message.update({
            where: { id: questionnaireAnswer.id },
            data: { content: '', reasoningContent: null, completedAt: now },
          });
        }
        await transaction.message.createMany({
          data: [
            {
              conversationId: request.conversationId,
              authorUserId: userId,
              role: MessageRole.USER,
              status: MessageStatus.COMPLETED,
              content: answerSummary,
              createdAt: answerCreatedAt,
              completedAt: now,
            },
            {
              conversationId: request.conversationId,
              role: MessageRole.ASSISTANT,
              status: MessageStatus.COMPLETED,
              content: `定时任务“${request.title}”已创建并开始监控。`,
              createdAt: confirmationCreatedAt,
              completedAt: confirmationCreatedAt,
            },
          ],
        });
        await transaction.conversation.update({
          where: { id: request.conversationId },
          data: { lastMessageAt: confirmationCreatedAt },
        });
      }
      return created;
    });
    return this.toResponse(task);
  }

  async list(userId: string, status?: ScheduledTaskStatusDto) {
    const items = await this.prisma.scheduledTask.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: [{ nextRunAt: 'asc' }, { createdAt: 'desc' }],
    });
    return { items: items.map((task) => this.toResponse(task)) };
  }

  async updateStatus(
    userId: string,
    taskId: string,
    status: ScheduledTaskStatusDto,
  ) {
    const existing = await this.prisma.scheduledTask.findFirst({
      where: { id: taskId, userId },
    });
    if (!existing) {
      throw new ApiException(
        'NOT_FOUND',
        '定时任务不存在',
        HttpStatus.NOT_FOUND,
      );
    }
    const task = await this.prisma.scheduledTask.update({
      where: { id: taskId },
      data: {
        status,
        nextRunAt:
          status === ScheduledTaskStatus.ACTIVE
            ? (existing.nextRunAt ??
              nextScheduledRun(
                existing.cadence,
                new Date(),
                existing.timeOfDay,
                existing.timezoneOffsetMinutes,
              ))
            : null,
      },
    });
    return this.toResponse(task);
  }

  async update(
    userId: string,
    taskId: string,
    input: UpdateScheduledTaskRequest,
  ) {
    const existing = await this.findScoped(userId, taskId);
    const cadence = input.cadence ?? existing.cadence;
    const timeOfDay = input.timeOfDay ?? existing.timeOfDay;
    const task = await this.prisma.scheduledTask.update({
      where: { id: taskId },
      data: {
        ...input,
        nextRunAt:
          existing.status === ScheduledTaskStatus.ACTIVE &&
          (input.cadence || input.timeOfDay)
            ? nextScheduledRun(
                cadence,
                new Date(),
                timeOfDay,
                existing.timezoneOffsetMinutes,
              )
            : undefined,
      },
    });
    return this.toResponse(task);
  }

  async delete(userId: string, taskId: string): Promise<void> {
    await this.findScoped(userId, taskId);
    await this.prisma.scheduledTask.delete({ where: { id: taskId } });
  }

  async runNow(userId: string, taskId: string) {
    const task = await this.findScoped(userId, taskId);
    const result = await this.startTaskRun(
      task,
      `task-run:${task.id}:${randomUUID()}`,
    );
    await this.prisma.scheduledTask.update({
      where: { id: task.id },
      data: { lastRunAt: new Date() },
    });
    return result;
  }

  async dispatchDue(now = new Date()) {
    const due = await this.prisma.scheduledTask.findMany({
      where: { status: ScheduledTaskStatus.ACTIVE, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: 'asc' },
      take: 20,
    });
    for (const task of due) {
      const scheduledFor = task.nextRunAt!;
      const nextRunAt = nextScheduledRun(
        task.cadence,
        scheduledFor,
        task.timeOfDay,
        task.timezoneOffsetMinutes,
      );
      const claimed = await this.prisma.scheduledTask.updateMany({
        where: {
          id: task.id,
          status: ScheduledTaskStatus.ACTIVE,
          nextRunAt: scheduledFor,
        },
        data: { lastRunAt: now, nextRunAt },
      });
      if (claimed.count !== 1) continue;
      try {
        await this.startTaskRun(
          task,
          `scheduled:${task.id}:${scheduledFor.toISOString()}`,
        );
      } catch {
        this.logger.error(`定时任务入队失败 taskId=${task.id}`);
      }
    }
  }

  /** 每次执行都创建独立对话，避免将周期结果混入任务设置对话。 */
  private startTaskRun(
    task: { id: string; userId: string; title: string; prompt: string },
    idempotencyKey: string,
  ) {
    return this.generations.createConversationWithGeneration(
      task.userId,
      idempotencyKey,
      {
        title: task.title,
        content: task.prompt,
        clientMessageId: randomUUID(),
        reasoningEnabled: false,
        taskQuestionnaire: false,
      },
    );
  }

  private toResponse(task: {
    id: string;
    conversationId: string;
    title: string;
    prompt: string;
    cadence: ScheduledTaskCadence;
    timeOfDay: string;
    timezoneOffsetMinutes: number;
    status: ScheduledTaskStatus;
    nextRunAt: Date | null;
    lastRunAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): ScheduledTaskResponse {
    return {
      ...task,
      nextRunAt: task.nextRunAt?.toISOString() ?? null,
      lastRunAt: task.lastRunAt?.toISOString() ?? null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  }

  private async findScoped(userId: string, taskId: string) {
    const task = await this.prisma.scheduledTask.findFirst({
      where: { id: taskId, userId },
    });
    if (!task) {
      throw new ApiException(
        'NOT_FOUND',
        '定时任务不存在',
        HttpStatus.NOT_FOUND,
      );
    }
    return task;
  }
}
