import { Module } from '@nestjs/common';
import { GenerationsController } from './generations.controller';
import { GenerationsService } from './generations.service';

@Module({
  controllers: [GenerationsController],
  providers: [GenerationsService],
})
export class GenerationsModule {}
