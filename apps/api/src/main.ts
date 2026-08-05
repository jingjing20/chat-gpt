import { readApiEnv } from '@chat/config';
import { Logger, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  loadEnv({
    path: process.env.ENV_FILE ?? resolve(process.cwd(), '../../.env'),
    quiet: true,
  });
  const environment = readApiEnv(process.env);
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });

  await app.listen(environment.API_PORT, '0.0.0.0');
  Logger.log(
    `API listening on http://localhost:${environment.API_PORT}`,
    'Bootstrap',
  );
}
void bootstrap();
