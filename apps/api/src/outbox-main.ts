/** 启动独立 Outbox Relay 进程，便于与 HTTP API 分开扩缩容。 */

import {
  initializeOpenTelemetry,
  JsonLogger,
  shutdownOpenTelemetry,
} from '@chat/observability';
import { NestFactory } from '@nestjs/core';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { OutboxRelayModule } from './outbox-relay.module';

async function bootstrap() {
  loadEnv({
    path: process.env.ENV_FILE ?? resolve(process.cwd(), '../../.env'),
    quiet: true,
  });
  initializeOpenTelemetry('concurrent-chat-outbox-relay');
  process.once('beforeExit', () => void shutdownOpenTelemetry());
  const application = await NestFactory.createApplicationContext(
    OutboxRelayModule,
    { logger: new JsonLogger() },
  );
  application.enableShutdownHooks();
}

void bootstrap();
