import { z } from 'zod';

export const serviceNameSchema = z.enum(['api', 'worker']);

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: serviceNameSchema,
  timestamp: z.string().datetime(),
  checks: z.record(z.string(), z.literal('ok')).optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
