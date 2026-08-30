/** 向 Worker 依赖注入容器提供经过校验的运行时配置。 */

import { Global, Module } from '@nestjs/common';
import { loadWorkerEnv, WORKER_ENV } from './worker-config';

@Global()
@Module({
  providers: [{ provide: WORKER_ENV, useFactory: loadWorkerEnv }],
  exports: [WORKER_ENV],
})
export class WorkerConfigModule {}
