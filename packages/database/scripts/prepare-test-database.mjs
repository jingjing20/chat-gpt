import { spawnSync } from 'node:child_process';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://chat:chat_local_password@localhost:15432/chat_test?schema=public';
const databaseName = new URL(databaseUrl).pathname.slice(1);

if (databaseName !== 'chat_test') {
  throw new Error('测试迁移只能应用到 chat_test 数据库');
}

const result = spawnSync(
  process.execPath,
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
