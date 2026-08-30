/** 启动 Worker 进程，初始化遥测、日志、HTTP 端点和优雅退出。 */

import { Logger } from '@nestjs/common';
import {
  initializeOpenTelemetry,
  JsonLogger,
  shutdownOpenTelemetry,
} from '@chat/observability';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadWorkerEnv } from './config/worker-config';

async function bootstrap() {
  const environment = loadWorkerEnv();
  initializeOpenTelemetry('concurrent-chat-worker');
  process.once('beforeExit', () => void shutdownOpenTelemetry());
  const app = await NestFactory.create(AppModule, { logger: new JsonLogger() });
  app.enableShutdownHooks();

  await app.listen(environment.WORKER_HEALTH_PORT, '0.0.0.0');
  Logger.log(
    `Worker health server listening on http://localhost:${environment.WORKER_HEALTH_PORT}`,
    'Bootstrap',
  );
}
void bootstrap();
