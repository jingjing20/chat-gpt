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
