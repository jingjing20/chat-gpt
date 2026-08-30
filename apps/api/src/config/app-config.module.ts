/** 向 API 依赖注入容器提供经过校验的运行时配置。 */

import { Global, Module } from '@nestjs/common';
import { API_ENV, loadApiEnv } from './app-config';

@Global()
@Module({
  providers: [{ provide: API_ENV, useFactory: loadApiEnv }],
  exports: [API_ENV],
})
export class AppConfigModule {}
