import { ScheduledTaskCadence } from '@chat/database';
import { ApiException } from '../http/api-exception';
import {
  nextScheduledRun,
  taskCompletionMessageTimes,
  TasksService,
} from './tasks.service';

describe('nextScheduledRun', () => {
  it('按日和按周稳定推进 UTC 运行时间', () => {
    const from = new Date('2026-09-04T08:30:00.000Z');
    expect(
      nextScheduledRun(ScheduledTaskCadence.DAILY, from).toISOString(),
    ).toBe('2026-09-05T08:30:00.000Z');
    expect(
      nextScheduledRun(ScheduledTaskCadence.WEEKLY, from).toISOString(),
    ).toBe('2026-09-11T08:30:00.000Z');
  });

  it('按用户时区保持本地运行时间', () => {
    const from = new Date('2026-09-04T12:00:00.000Z');
    expect(
      nextScheduledRun(
        ScheduledTaskCadence.DAILY,
        from,
        '09:00',
        480,
      ).toISOString(),
    ).toBe('2026-09-05T01:00:00.000Z');
  });
});

describe('taskCompletionMessageTimes', () => {
  it('保证用户问答消息严格早于服务端确认消息', () => {
    const times = taskCompletionMessageTimes(
      new Date('2026-09-04T08:30:00.000Z'),
    );
    expect(times.confirmationCreatedAt.getTime()).toBe(
      times.answerCreatedAt.getTime() + 1,
    );
  });
});

describe('TasksService 用户隔离', () => {
  it('创建任务前校验关联对话属于当前用户', async () => {
    const prisma = {
      conversation: { findFirst: jest.fn().mockResolvedValue(null) },
      scheduledTask: { create: jest.fn() },
    };
    const service = new TasksService(
      prisma as never,
      { create: jest.fn() } as never,
    );

    await expect(
      service.create('user-a', {
        conversationId: '5f6c755d-bb79-4aee-b06d-8397cc57862d',
        title: '每日简报',
        prompt: '生成简报',
        cadence: 'DAILY',
        timeOfDay: '09:00',
        timezoneOffsetMinutes: 480,
      }),
    ).rejects.toBeInstanceOf(ApiException);
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: {
        id: '5f6c755d-bb79-4aee-b06d-8397cc57862d',
        ownerUserId: 'user-a',
      },
      select: { id: true },
    });
    expect(prisma.scheduledTask.create).not.toHaveBeenCalled();
  });

  it('列表查询始终带当前用户作用域', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new TasksService(
      { scheduledTask: { findMany } } as never,
      { create: jest.fn() } as never,
    );

    await service.list('user-a', 'PAUSED');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-a', status: 'PAUSED' },
      }),
    );
  });

  it('运行记录查询先校验任务归属并带用户作用域', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new TasksService(
      {
        scheduledTask: {
          findFirst: jest.fn().mockResolvedValue({ id: 'task-a' }),
        },
        scheduledTaskRun: { findMany },
      } as never,
      {} as never,
    );

    await service.listRuns('user-a', 'task-a');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: 'task-a', userId: 'user-a' },
      }),
    );
  });
});

describe('TasksService 运行定时任务', () => {
  const task = {
    id: '2ed4fc0f-19b8-4f38-b209-7a60f2f69670',
    userId: 'user-a',
    conversationId: '5f6c755d-bb79-4aee-b06d-8397cc57862d',
    executionConversationId: '9b5f25af-26fe-4714-a811-87bd3ce357ca',
    title: 'AI 技术简报',
    prompt: '每天整理 AI 技术变化',
    cadence: ScheduledTaskCadence.DAILY,
    timeOfDay: '09:00',
    timezoneOffsetMinutes: 480,
    status: 'ACTIVE',
    nextRunAt: new Date('2026-09-05T01:00:00.000Z'),
    lastRunAt: null,
  };

  it('立即运行时新建对话并将任务提示词作为首条用户消息', async () => {
    const createConversationWithGeneration = jest.fn().mockResolvedValue({
      conversation: { id: '7a2f4294-ff65-48c4-814f-924ab4127d19' },
    });
    const prisma = {
      scheduledTask: {
        findFirst: jest.fn().mockResolvedValue(task),
        update: jest.fn().mockResolvedValue(task),
      },
    };
    const service = new TasksService(
      prisma as never,
      {
        createConversationWithGeneration,
      } as never,
    );

    const result = await service.runNow('user-a', task.id);

    expect(createConversationWithGeneration).toHaveBeenCalledWith(
      'user-a',
      expect.stringMatching(/^task-run:/),
      expect.objectContaining({
        title: task.title,
        content: task.prompt,
        reasoningEnabled: false,
        taskQuestionnaire: false,
      }),
      {
        isolatedContext: true,
        scheduledTaskRun: {
          taskId: task.id,
          trigger: 'MANUAL',
          scheduledFor: null,
        },
      },
    );
    expect(result.conversation.id).not.toBe(task.conversationId);
  });

  it('到点触发复用未归档的当前执行对话', async () => {
    const create = jest.fn().mockResolvedValue({
      conversation: { id: '7a2f4294-ff65-48c4-814f-924ab4127d19' },
    });
    const createConversationWithGeneration = jest.fn();
    const prisma = {
      scheduledTask: {
        findMany: jest.fn().mockResolvedValue([task]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      scheduledTaskRun: { findFirst: jest.fn().mockResolvedValue(null) },
      conversationUserState: {
        findUnique: jest.fn().mockResolvedValue({ archivedAt: null }),
      },
    };
    const service = new TasksService(
      prisma as never,
      {
        create,
        createConversationWithGeneration,
      } as never,
    );

    await service.dispatchDue(new Date('2026-09-05T01:00:00.000Z'));

    expect(create).toHaveBeenCalledWith(
      task.userId,
      task.executionConversationId,
      `scheduled:${task.id}:2026-09-05T01:00:00.000Z`,
      expect.objectContaining({ content: task.prompt }),
      {
        isolatedContext: true,
        scheduledTaskRun: {
          taskId: task.id,
          trigger: 'SCHEDULED',
          scheduledFor: new Date('2026-09-05T01:00:00.000Z'),
        },
      },
    );
    expect(createConversationWithGeneration).not.toHaveBeenCalled();
  });

  it('定时触发在没有可用执行对话时创建新对话', async () => {
    const withoutExecutionConversation = {
      ...task,
      executionConversationId: null,
    };
    const createConversationWithGeneration = jest.fn().mockResolvedValue({
      conversation: { id: '7a2f4294-ff65-48c4-814f-924ab4127d19' },
    });
    const prisma = {
      scheduledTask: {
        findMany: jest.fn().mockResolvedValue([withoutExecutionConversation]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      scheduledTaskRun: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new TasksService(
      prisma as never,
      {
        createConversationWithGeneration,
      } as never,
    );

    await service.dispatchDue(new Date('2026-09-05T01:00:00.000Z'));

    expect(createConversationWithGeneration).toHaveBeenCalledWith(
      task.userId,
      `scheduled:${task.id}:2026-09-05T01:00:00.000Z`,
      expect.objectContaining({ title: task.title, content: task.prompt }),
      expect.objectContaining({ isolatedContext: true }),
    );
  });
});
