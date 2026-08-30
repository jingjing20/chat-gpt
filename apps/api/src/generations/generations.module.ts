/** 组装 generation 领域控制器及服务。 */

import { Module } from '@nestjs/common';
import { GenerationsController } from './generations.controller';
import { GenerationsService } from './generations.service';

@Module({
  controllers: [GenerationsController],
  providers: [GenerationsService],
})
export class GenerationsModule {}
