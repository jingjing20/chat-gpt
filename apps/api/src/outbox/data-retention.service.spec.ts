import type { ApiEnv } from '@chat/config';
import { AuditAction } from '@chat/database';
import type { PrismaService } from '../database/prisma.service';
import { DataRetentionService } from './data-retention.service';

describe('DataRetentionService', () => {
  it('只清理到期技术数据，不删除未发布或死信 Outbox', async () => {
    const outboxDelete = jest.fn().mockResolvedValue({ count: 1 });
    const auditDelete = jest
      .fn()
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 3 });
    const usageDelete = jest.fn().mockResolvedValue({ count: 4 });
    const prisma = {
      outboxEvent: { deleteMany: outboxDelete },
      auditLog: { deleteMany: auditDelete },
      usageRecord: { deleteMany: usageDelete },
    } as unknown as PrismaService;
    const environment = {
      OUTBOX_RETENTION_DAYS: 7,
      AUDIT_RETENTION_DAYS: 180,
      SECURITY_AUDIT_RETENTION_DAYS: 730,
      USAGE_RETENTION_DAYS: 730,
    } as ApiEnv;
    const now = new Date('2026-09-01T00:00:00.000Z');

    await expect(
      new DataRetentionService(prisma, environment).cleanupOnce(now),
    ).resolves.toBe(10);
    expect(outboxDelete).toHaveBeenCalledWith({
      where: { publishedAt: { lt: new Date('2026-08-25T00:00:00.000Z') } },
    });
    expect(auditDelete).toHaveBeenNthCalledWith(1, {
      where: {
        action: {
          notIn: [
            AuditAction.SESSION_REJECTED,
            AuditAction.CONVERSATION_DELETED,
          ],
        },
        createdAt: { lt: new Date('2026-03-05T00:00:00.000Z') },
      },
    });
  });
});
