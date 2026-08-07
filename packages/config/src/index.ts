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
  LLM_PROVIDER: z.string().trim().min(1).default('deepseek'),
  OUTBOX_DISPATCH_INTERVAL_MS: z.coerce.number().int().min(50).default(500),
  OUTBOX_DISPATCH_BATCH_SIZE: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20),
  GENERATION_QUEUE_PREFIX: z.string().trim().min(1).default('chat:dev:queue'),
  EVENT_KEY_PREFIX: z.string().trim().min(1).default('chat:dev:evt'),
  EVENT_HEARTBEAT_MS: z.coerce.number().int().min(1_000).default(20_000),
  USER_GENERATION_CONCURRENCY_LIMIT: z.coerce.number().int().min(1).default(2),
});

export const workerEnvSchema = infrastructureSchema
  .extend({
    WORKER_HEALTH_PORT: z.coerce
      .number()
      .int()
      .min(1)
      .max(65_535)
      .default(3002),
    LLM_PROVIDER: z.literal('deepseek').default('deepseek'),
    LLM_BASE_URL: z.string().url().default('https://api.deepseek.com'),
    LLM_API_KEY: z.string().default(''),
    LLM_DEFAULT_MODEL: z.string().trim().min(1).default('deepseek-v4-flash'),
    LLM_REASONING_MODE: z.enum(['enabled', 'disabled']).default('enabled'),
    LLM_REASONING_EFFORT: z.enum(['low', 'medium', 'high']).default('high'),
    LLM_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1).default(600_000),
    LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).default(8192),
    LLM_USER_HASH_SECRET: z
      .string()
      .min(32)
      .default('development-only-user-hash-secret'),
    GENERATION_QUEUE_PREFIX: z.string().trim().min(1).default('chat:dev:queue'),
    GENERATION_WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(4),
    GENERATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    GENERATION_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).default(250),
    GENERATION_CANCEL_POLL_MS: z.coerce.number().int().min(25).default(200),
    EVENT_KEY_PREFIX: z.string().trim().min(1).default('chat:dev:evt'),
    GENERATION_DELTA_FLUSH_MS: z.coerce.number().int().min(10).default(30),
    GENERATION_DELTA_MAX_CHARS: z.coerce.number().int().min(32).default(384),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV === 'production' && !environment.LLM_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['LLM_API_KEY'],
        message: '生产环境必须配置 LLM_API_KEY',
      });
    }
    if (
      environment.NODE_ENV === 'production' &&
      environment.LLM_USER_HASH_SECRET === 'development-only-user-hash-secret'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['LLM_USER_HASH_SECRET'],
        message: '生产环境必须配置独立的 LLM_USER_HASH_SECRET',
      });
    }
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

export function redisConnectionOptions(redisUrl: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
} {
  const parsed = new URL(redisUrl);
  const database = parsed.pathname.slice(1);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    ...(parsed.username
      ? { username: decodeURIComponent(parsed.username) }
      : {}),
    ...(parsed.password
      ? { password: decodeURIComponent(parsed.password) }
      : {}),
    ...(database ? { db: Number(database) } : {}),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
