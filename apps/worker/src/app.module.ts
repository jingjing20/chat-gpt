import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DevelopmentLlmController } from './llm/development-llm.controller';

@Module({
  imports: [],
  controllers: [HealthController, DevelopmentLlmController],
  providers: [],
})
export class AppModule {}
