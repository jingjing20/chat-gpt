/** 从进程环境变量加载并校验 API 运行时配置。 */

import { readApiEnv, type ApiEnv } from '@chat/config';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

export const API_ENV = Symbol('API_ENV');

export function loadApiEnv(): ApiEnv {
  loadEnv({
    path: process.env.ENV_FILE ?? resolve(process.cwd(), '../../.env'),
    quiet: true,
  });
  return readApiEnv(process.env);
}
