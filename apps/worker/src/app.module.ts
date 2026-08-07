import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DevelopmentLlmController } from './llm/development-llm.controller';
import { WorkerConfigModule } from './config/worker-config.module';
import { DatabaseModule } from './database/database.module';
import { GenerationModule } from './generation/generation.module';

@Module({
  imports: [WorkerConfigModule, DatabaseModule, GenerationModule],
  controllers: [HealthController, DevelopmentLlmController],
  providers: [],
})
export class AppModule {}
