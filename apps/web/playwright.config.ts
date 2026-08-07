import { defineConfig, devices } from '@playwright/test';

const webPort = process.env.E2E_WEB_PORT ?? '3000';
const apiPort = process.env.E2E_API_PORT ?? '3001';
const webBaseUrl = `http://127.0.0.1:${webPort}`;
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const webCommand = process.env.E2E_WEB_COMMAND ?? `pnpm dev --port ${webPort}`;

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.e2e-spec.ts',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'line',
  use: {
    baseURL: webBaseUrl,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    channel: 'chrome',
  },
  webServer: [
    {
      command: 'pnpm --dir ../api start',
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
      command: 'pnpm --dir ../worker start',
      url: 'http://127.0.0.1:3002/health/live',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        DATABASE_URL:
          process.env.TEST_DATABASE_URL ??
          'postgresql://chat:chat_local_password@localhost:15432/chat_test?schema=public',
        REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:16379',
        LLM_USER_HASH_SECRET: 'test-worker-user-hash-secret-at-least-32-chars',
        WORKER_HEALTH_PORT: '3002',
      },
    },
    {
      command: webCommand,
      url: `${webBaseUrl}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        API_INTERNAL_URL: apiBaseUrl,
      },
    },
  ],
});
