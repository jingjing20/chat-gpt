import { Module } from '@nestjs/common';
import { GenerationProcessor } from './generation.processor';
import { GenerationWorkerService } from './generation-worker.service';
import { ProviderModule } from './provider.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [ProviderModule, EventsModule],
  providers: [GenerationProcessor, GenerationWorkerService],
  exports: [GenerationProcessor],
})
export class GenerationModule {}
