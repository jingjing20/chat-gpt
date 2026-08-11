import { Module } from '@nestjs/common';
import { GenerationProcessor } from './generation.processor';
import { GenerationWorkerService } from './generation-worker.service';
import { ProviderModule } from './provider.module';
import { EventsModule } from '../events/events.module';
import { GenerationReliabilityService } from './generation-reliability.service';
import { ZombieGenerationMonitorService } from './zombie-generation-monitor.service';

@Module({
  imports: [ProviderModule, EventsModule],
  providers: [
    GenerationReliabilityService,
    GenerationProcessor,
    GenerationWorkerService,
    ZombieGenerationMonitorService,
  ],
  exports: [GenerationProcessor],
})
export class GenerationModule {}
