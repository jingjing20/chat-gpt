import { defineConfig, devices } from '@playwright/test';

const webPort = process.env.E2E_WEB_PORT ?? '3000';
const apiPort = process.env.E2E_API_PORT ?? '3001';
const workerPort = process.env.E2E_WORKER_PORT ?? '3002';
const webBaseUrl = `http://127.0.0.1:${webPort}`;
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  testDir: '.',
  testMatch: 'multi-conversation-trace.e2e-spec.ts',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: 'line',
  outputDir: '../../test-results/multi-conversation-trace',
  use: {
    baseURL: webBaseUrl,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    channel: 'chrome',
  },
  webServer: [
    {
      command: 'pnpm --dir ../../apps/api start',
      url: `${apiBaseUrl}/health/live`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        DATABASE_URL:
          process.env.TEST_DATABASE_URL ??
          'postgresql://chat:chat_local_password@localhost:15432/chat_test?schema=public',
        REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:16379',
        ACCESS_TOKEN_SECRET:
          process.env.ACCESS_TOKEN_SECRET ??
          'test-only-access-token-secret-at-least-32-chars',
        AUTH_COOKIE_SECURE: 'false',
        AUTH_RATE_LIMIT_MAX: '100',
        API_PORT: apiPort,
      },
    },
    {
      command: 'pnpm --dir ../../apps/worker start',
      url: `http://127.0.0.1:${workerPort}/health/live`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        DATABASE_URL:
          process.env.TEST_DATABASE_URL ??
          'postgresql://chat:chat_local_password@localhost:15432/chat_test?schema=public',
        REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:16379',
        LLM_USER_HASH_SECRET: 'test-worker-user-hash-secret-at-least-32-chars',
        WORKER_HEALTH_PORT: workerPort,
      },
    },
    {
      command: `pnpm --dir ../../apps/web dev --port ${webPort}`,
      url: `${webBaseUrl}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        API_INTERNAL_URL: apiBaseUrl,
      },
    },
  ],
});
