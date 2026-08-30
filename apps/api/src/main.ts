/** 启动 API 进程，初始化遥测、日志、应用配置及优雅退出。 */

import { readApiEnv } from '@chat/config';
import {
  initializeOpenTelemetry,
  JsonLogger,
  shutdownOpenTelemetry,
} from '@chat/observability';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

async function bootstrap() {
  loadEnv({
    path: process.env.ENV_FILE ?? resolve(process.cwd(), '../../.env'),
    quiet: true,
  });
  const environment = readApiEnv(process.env);
  initializeOpenTelemetry('concurrent-chat-api');
  process.once('beforeExit', () => void shutdownOpenTelemetry());
  const app = await NestFactory.create(AppModule, { logger: new JsonLogger() });
  app.enableShutdownHooks();
  configureApp(app);

  await app.listen(environment.API_PORT, '0.0.0.0');
  Logger.log(
    `API listening on http://localhost:${environment.API_PORT}`,
    'Bootstrap',
  );
}
void bootstrap();
