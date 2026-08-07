import { Module } from '@nestjs/common';
import { GenerationProcessor } from './generation.processor';
import { GenerationWorkerService } from './generation-worker.service';
import { ProviderModule } from './provider.module';

@Module({
  imports: [ProviderModule],
  providers: [GenerationProcessor, GenerationWorkerService],
  exports: [GenerationProcessor],
})
export class GenerationModule {}
