import { HealthController } from './health.controller';
import type { PrismaService } from './database/prisma.service';

describe('HealthController', () => {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  } as unknown as PrismaService;
  const controller = new HealthController(prisma);

  it('报告 API 进程存活', () => {
    expect(controller.live()).toMatchObject({
      status: 'ok',
      service: 'api',
    });
  });

  it('报告配置和数据库均已就绪', async () => {
    await expect(controller.ready()).resolves.toMatchObject({
      status: 'ok',
      service: 'api',
      checks: { config: 'ok', database: 'ok' },
    });
  });
});
