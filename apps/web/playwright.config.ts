import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.e2e-spec.ts',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'line',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    channel: 'chrome',
  },
  webServer: [
    {
      command: 'pnpm --dir ../api start',
      url: 'http://127.0.0.1:3001/health/live',
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
        API_PORT: '3001',
      },
    },
    {
      command: 'pnpm dev',
      url: 'http://127.0.0.1:3000/login',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        API_INTERNAL_URL: 'http://127.0.0.1:3001',
      },
    },
  ],
});
