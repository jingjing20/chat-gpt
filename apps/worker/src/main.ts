import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadWorkerEnv } from './config/worker-config';

async function bootstrap() {
  const environment = loadWorkerEnv();
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  await app.listen(environment.WORKER_HEALTH_PORT, '0.0.0.0');
  Logger.log(
    `Worker health server listening on http://localhost:${environment.WORKER_HEALTH_PORT}`,
    'Bootstrap',
  );
}
void bootstrap();
