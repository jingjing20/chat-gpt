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

export const conversationResponseSchema = z.object({
  id: z.string().uuid(),
  title: conversationTitleSchema,
  archivedAt: z.string().datetime().nullable(),
  lastReadAt: z.string().datetime().nullable(),
  scrollOffset: z.number().int().nonnegative(),
  lastMessageAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const conversationListResponseSchema = z.object({
  items: z.array(conversationResponseSchema),
});

export const messageResponseSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: messageRoleSchema,
  content: z.string(),
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
