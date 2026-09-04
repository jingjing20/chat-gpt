/** 集中定义跨进程传输的 Zod Schema 与共享 DTO 类型。 */

import { z } from 'zod';

export const serviceNameSchema = z.enum(['api', 'worker']);

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: serviceNameSchema,
  timestamp: z.string().datetime(),
  checks: z.record(z.string(), z.literal('ok')).optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const emailSchema = z.string().trim().toLowerCase().email().max(320);

export const passwordSchema = z.string().min(12).max(128);

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const loginRequestSchema = registerRequestSchema;

export const userResponseSchema = z.object({
  id: z.string().uuid(),
  email: emailSchema,
  status: z.literal('ACTIVE'),
  createdAt: z.string().datetime(),
});

export const authResponseSchema = z.object({
  user: userResponseSchema,
  csrfToken: z.string().min(32),
});

export const csrfResponseSchema = z.object({
  csrfToken: z.string().min(32),
});

export const errorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string(),
  details: z.unknown().optional(),
});

export const protectedResourceResponseSchema = z.object({
  ownerId: z.string().uuid(),
  value: z.literal('用户隔离验证资源'),
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type UserResponse = z.infer<typeof userResponseSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type CsrfResponse = z.infer<typeof csrfResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type ProtectedResourceResponse = z.infer<
  typeof protectedResourceResponseSchema
>;

export const conversationTitleSchema = z.string().trim().min(1).max(120);

export const createConversationRequestSchema = z.object({
  title: conversationTitleSchema.default('新对话'),
});

export const renameConversationRequestSchema = z.object({
  title: conversationTitleSchema,
});

export const updateScrollPositionRequestSchema = z.object({
  scrollOffset: z.number().int().min(0).max(10_000_000),
});

export const createMessageRequestSchema = z.object({
  content: z.string().trim().min(1).max(20_000),
});

export const messageRoleSchema = z.enum(['USER', 'ASSISTANT', 'SYSTEM']);
export const messageStatusSchema = z.enum([
  'PENDING',
  'STREAMING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export const conversationResponseSchema = z.object({
  id: z.string().uuid(),
  title: conversationTitleSchema,
  archivedAt: z.string().datetime().nullable(),
  lastReadAt: z.string().datetime().nullable(),
  scrollOffset: z.number().int().nonnegative(),
  hasUnread: z.boolean(),
  lastMessageAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const conversationListResponseSchema = z.object({
  items: z.array(conversationResponseSchema),
  nextCursor: z.string().nullable(),
});

export const messageResponseSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: messageRoleSchema,
  status: messageStatusSchema,
  content: z.string(),
  reasoningContent: z.string().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export const messagePageResponseSchema = z.object({
  items: z.array(messageResponseSchema),
  nextCursor: z.string().nullable(),
});

export const createMessageResponseSchema = z.object({
  userMessage: messageResponseSchema,
  assistantMessage: messageResponseSchema,
});

export type CreateConversationRequest = z.infer<
  typeof createConversationRequestSchema
>;
export type RenameConversationRequest = z.infer<
  typeof renameConversationRequestSchema
>;
export type UpdateScrollPositionRequest = z.infer<
  typeof updateScrollPositionRequestSchema
>;
export type CreateMessageRequest = z.infer<typeof createMessageRequestSchema>;
export type ConversationResponse = z.infer<typeof conversationResponseSchema>;
export type ConversationListResponse = z.infer<
  typeof conversationListResponseSchema
>;
export type MessageResponse = z.infer<typeof messageResponseSchema>;
export type MessagePageResponse = z.infer<typeof messagePageResponseSchema>;
export type CreateMessageResponse = z.infer<typeof createMessageResponseSchema>;

export const generationStatusSchema = z.enum([
  'QUEUED',
  'STARTING',
  'STREAMING',
  'CANCEL_REQUESTED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export type GenerationStatus = z.infer<typeof generationStatusSchema>;

export const createGenerationRequestSchema = z.object({
  content: z.string().trim().min(1).max(20_000),
  clientMessageId: z.string().uuid(),
  reasoningEnabled: z.boolean().default(false),
});

export const createConversationGenerationRequestSchema =
  createGenerationRequestSchema.extend({
    title: conversationTitleSchema,
    taskQuestionnaire: z.boolean().default(false),
  });

export const generationResponseSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  requestMessageId: z.string().uuid(),
  responseMessageId: z.string().uuid(),
  provider: z.string(),
  model: z.string(),
  reasoningEnabled: z.boolean(),
  status: generationStatusSchema,
  lastSequence: z.number().int().nonnegative(),
  finishReason: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorDetailSafe: z.string().nullable(),
  cancelRequestedAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  firstTokenAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createGenerationResponseSchema = z.object({
  conversation: z.object({ id: z.string().uuid() }),
  userMessage: messageResponseSchema,
  assistantMessage: messageResponseSchema,
  generation: generationResponseSchema,
});

export const generationJobSchema = z.object({
  generationId: z.string().uuid(),
});

export type CreateGenerationRequest = z.infer<
  typeof createGenerationRequestSchema
>;
export type CreateConversationGenerationRequest = z.infer<
  typeof createConversationGenerationRequestSchema
>;
export type GenerationResponse = z.infer<typeof generationResponseSchema>;
export type CreateGenerationResponse = z.infer<
  typeof createGenerationResponseSchema
>;
export type GenerationJob = z.infer<typeof generationJobSchema>;

export const scheduledTaskStatusSchema = z.enum([
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
]);
export const scheduledTaskCadenceSchema = z.enum(['DAILY', 'WEEKLY']);
export const createScheduledTaskRequestSchema = z.object({
  conversationId: z.string().uuid(),
  title: conversationTitleSchema,
  prompt: z.string().trim().min(1).max(20_000),
  cadence: scheduledTaskCadenceSchema,
  timeOfDay: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default('09:00'),
  timezoneOffsetMinutes: z.number().int().min(-840).max(840).default(0),
  answers: z
    .array(
      z.object({
        question: z.string().max(500),
        answer: z.string().max(500),
      }),
    )
    .max(10)
    .optional(),
});
export const updateScheduledTaskRequestSchema = createScheduledTaskRequestSchema
  .omit({ conversationId: true, answers: true, timezoneOffsetMinutes: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export const updateScheduledTaskStatusRequestSchema = z.object({
  status: scheduledTaskStatusSchema,
});
export const scheduledTaskResponseSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  title: conversationTitleSchema,
  prompt: z.string(),
  cadence: scheduledTaskCadenceSchema,
  timeOfDay: z.string(),
  timezoneOffsetMinutes: z.number().int(),
  status: scheduledTaskStatusSchema,
  nextRunAt: z.string().datetime().nullable(),
  lastRunAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const scheduledTaskListResponseSchema = z.object({
  items: z.array(scheduledTaskResponseSchema),
});
export type ScheduledTaskStatus = z.infer<typeof scheduledTaskStatusSchema>;
export type ScheduledTaskCadence = z.infer<typeof scheduledTaskCadenceSchema>;
export type CreateScheduledTaskRequest = z.infer<
  typeof createScheduledTaskRequestSchema
>;
export type UpdateScheduledTaskRequest = z.infer<
  typeof updateScheduledTaskRequestSchema
>;
export type ScheduledTaskResponse = z.infer<typeof scheduledTaskResponseSchema>;

export const generationAttemptResponseSchema = z.object({
  id: z.string().uuid(),
  generationId: z.string().uuid(),
  attemptNo: z.number().int().positive(),
  status: z.enum(['STARTED', 'COMPLETED', 'FAILED', 'CANCELLED']),
  providerRequestId: z.string().nullable(),
  receivedFirstDelta: z.boolean(),
  httpStatus: z.number().int().nullable(),
  errorCode: z.string().nullable(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
});
export const generationAttemptListResponseSchema = z.object({
  generationId: z.string().uuid(),
  attempts: z.array(generationAttemptResponseSchema),
});
export type GenerationAttemptListResponse = z.infer<
  typeof generationAttemptListResponseSchema
>;

export const generationEventTypeSchema = z.enum([
  'generation.started',
  'message.reasoning_delta',
  'message.delta',
  'message.snapshot',
  'generation.usage',
  'generation.completed',
  'generation.failed',
  'generation.cancelled',
]);

export const terminalGenerationEventTypeSchema = z.enum([
  'generation.completed',
  'generation.failed',
  'generation.cancelled',
]);

/** PostgreSQL Outbox 中的可靠终态事件；eventId 由 Outbox 主键提供。 */
export const generationTerminalOutboxPayloadSchema = z.object({
  version: z.literal(1),
  userId: z.string().uuid(),
  conversationId: z.string().uuid(),
  generationId: z.string().uuid(),
  messageId: z.string().uuid(),
  type: terminalGenerationEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  state: z.object({
    content: z.string(),
    reasoningContent: z.string().nullable(),
    status: z.enum(['COMPLETED', 'FAILED', 'CANCELLED']),
  }),
});

export type GenerationTerminalOutboxPayload = z.infer<
  typeof generationTerminalOutboxPayloadSchema
>;

/**
 * 用户级事件信封：conversationId 用于视图投影，generationId 和 sequence 用于隔离与排序。
 */
export const userEventSchema = z.object({
  version: z.literal(1),
  eventId: z.string().uuid(),
  streamId: z.string().regex(/^\d+-\d+$/),
  type: generationEventTypeSchema,
  conversationId: z.string().uuid(),
  generationId: z.string().uuid(),
  messageId: z.string().uuid(),
  sequence: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
});

export const generationEventHistorySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('events'),
    events: z.array(userEventSchema),
    lastSequence: z.number().int().nonnegative(),
  }),
  z.object({
    mode: z.literal('snapshot'),
    snapshot: z.object({
      content: z.string(),
      reasoningContent: z.string().nullable(),
      sequence: z.number().int().nonnegative(),
      status: generationStatusSchema,
    }),
  }),
]);

export type GenerationEventType = z.infer<typeof generationEventTypeSchema>;
export type UserEvent = z.infer<typeof userEventSchema>;
export type GenerationEventHistory = z.infer<
  typeof generationEventHistorySchema
>;

export const generationSyncResponseSchema = z.object({
  eventCursor: z.string().regex(/^\d+-\d+$/),
  activeGenerations: z.array(
    z.object({
      generationId: z.string().uuid(),
      conversationId: z.string().uuid(),
      messageId: z.string().uuid(),
      status: generationStatusSchema,
      content: z.string(),
      reasoningContent: z.string().nullable(),
      sequence: z.number().int().nonnegative(),
    }),
  ),
  reconciledGenerations: z.array(
    z.object({
      generationId: z.string().uuid(),
      conversationId: z.string().uuid(),
      messageId: z.string().uuid(),
      status: generationStatusSchema,
      content: z.string(),
      reasoningContent: z.string().nullable(),
      sequence: z.number().int().nonnegative(),
      error: z.string().nullable(),
    }),
  ),
});

export type GenerationSyncResponse = z.infer<
  typeof generationSyncResponseSchema
>;
