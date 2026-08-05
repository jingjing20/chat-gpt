import { z } from 'zod';

const nodeEnvSchema = z.enum(['development', 'test', 'production']);

const infrastructureSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
});

export const apiEnvSchema = infrastructureSchema.extend({
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
});

export const workerEnvSchema = infrastructureSchema.extend({
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(3002),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function readApiEnv(environment: NodeJS.ProcessEnv): ApiEnv {
  return apiEnvSchema.parse(environment);
}

export function readWorkerEnv(environment: NodeJS.ProcessEnv): WorkerEnv {
  return workerEnvSchema.parse(environment);
}
