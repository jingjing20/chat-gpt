/** 创建 BullMQ generation 队列并注册 Outbox 分发器。 */

import { redisConnectionOptions, type ApiEnv } from '@chat/config';
import { Logger, Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { API_ENV } from '../config/app-config';
import { GENERATION_QUEUE, GENERATION_QUEUE_NAME } from './outbox.constants';
import { OutboxDispatcherService } from './outbox-dispatcher.service';

@Module({
  providers: [
    {
      provide: GENERATION_QUEUE,
      inject: [API_ENV],
      useFactory: (environment: ApiEnv) => {
        const queue = new Queue(GENERATION_QUEUE_NAME, {
          connection: {
            ...redisConnectionOptions(environment.REDIS_URL),
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
          },
          prefix: environment.GENERATION_QUEUE_PREFIX,
        });
        queue.on('error', () => {
          Logger.error('Generation Queue 连接异常', OutboxModule.name);
        });
        return queue;
      },
    },
    OutboxDispatcherService,
  ],
  exports: [OutboxDispatcherService],
})
export class OutboxModule {}
