import { z } from 'zod';

const nodeEnvSchema = z.enum(['development', 'test', 'production']);

const infrastructureSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
});

export const apiEnvSchema = infrastructureSchema.extend({
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  ACCESS_TOKEN_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(3600)
    .default(2_592_000),
  AUTH_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
});

export const workerEnvSchema = infrastructureSchema.extend({
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(3002),
});

export const webEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  WEB_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  API_INTERNAL_URL: z.string().url().default('http://localhost:3001'),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export type WebEnv = z.infer<typeof webEnvSchema>;

export function readApiEnv(environment: NodeJS.ProcessEnv): ApiEnv {
  return apiEnvSchema.parse(environment);
}

export function readWorkerEnv(environment: NodeJS.ProcessEnv): WorkerEnv {
  return workerEnvSchema.parse(environment);
}

export function readWebEnv(environment: NodeJS.ProcessEnv): WebEnv {
  return webEnvSchema.parse(environment);
}
