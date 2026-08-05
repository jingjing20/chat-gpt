import { readWorkerEnv } from '@chat/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  loadEnv({
    path: process.env.ENV_FILE ?? resolve(process.cwd(), '../../.env'),
    quiet: true,
  });
  const environment = readWorkerEnv(process.env);
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  await app.listen(environment.WORKER_HEALTH_PORT, '0.0.0.0');
  Logger.log(
    `Worker health server listening on http://localhost:${environment.WORKER_HEALTH_PORT}`,
    'Bootstrap',
  );
}
void bootstrap();
