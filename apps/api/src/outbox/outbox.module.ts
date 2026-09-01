/** 创建 BullMQ generation 队列并注册 Outbox 分发器。 */

import { redisConnectionOptions, type ApiEnv } from '@chat/config';
import { metrics } from '@chat/observability';
import { Logger, Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { API_ENV } from '../config/app-config';
import {
  GENERATION_QUEUE,
  GENERATION_QUEUE_NAME,
  OUTBOX_EVENT_REDIS,
} from './outbox.constants';
import { OutboxDispatcherService } from './outbox-dispatcher.service';
import { DataRetentionService } from './data-retention.service';

@Module({
  providers: [
    {
      provide: GENERATION_QUEUE,
      inject: [API_ENV],
      useFactory: (environment: ApiEnv) => {
        const queue = new Queue(GENERATION_QUEUE_NAME, {
          connection: {
            ...redisConnectionOptions(environment.QUEUE_REDIS_URL),
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
          },
          prefix: environment.GENERATION_QUEUE_PREFIX,
        });
        queue.on('error', () => {
          metrics.increment('chat_redis_client_errors_total', {
            service: 'api',
            component: 'outbox_queue',
          });
          Logger.error('Generation Queue 连接异常', OutboxModule.name);
        });
        return queue;
      },
    },
    {
      provide: OUTBOX_EVENT_REDIS,
      inject: [API_ENV],
      useFactory: (environment: ApiEnv) => {
        const redis = new Redis({
          ...redisConnectionOptions(environment.CONTROL_REDIS_URL),
          maxRetriesPerRequest: 1,
        });
        redis.on('error', () => {
          metrics.increment('chat_redis_client_errors_total', {
            service: 'api',
            component: 'outbox_events',
          });
          Logger.error('Outbox Event Redis 连接异常', OutboxModule.name);
        });
        return redis;
      },
    },
    OutboxDispatcherService,
    DataRetentionService,
  ],
  exports: [OutboxDispatcherService],
})
export class OutboxModule {}
