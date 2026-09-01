/** 组装可独立运行的 Outbox Relay，不启动 HTTP 路由。 */

import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { OutboxModule } from './outbox/outbox.module';

@Module({ imports: [AppConfigModule, DatabaseModule, OutboxModule] })
export class OutboxRelayModule {}
