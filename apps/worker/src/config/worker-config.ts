/** 从进程环境变量加载并校验 Worker 运行时配置。 */

import { readWorkerEnv, type WorkerEnv } from '@chat/config';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

export const WORKER_ENV = Symbol('WORKER_ENV');

export function loadWorkerEnv(): WorkerEnv {
  loadEnv({
    path: process.env.ENV_FILE ?? resolve(process.cwd(), '../../.env'),
    quiet: true,
  });
  return readWorkerEnv(process.env);
}
