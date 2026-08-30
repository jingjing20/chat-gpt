/** 组装事件网关控制器及 Redis 事件服务。 */

import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({ controllers: [EventsController], providers: [EventsService] })
export class EventsModule {}
