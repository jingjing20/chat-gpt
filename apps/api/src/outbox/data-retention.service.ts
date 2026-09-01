/** 定期清理有明确保留期的技术数据，不自动删除用户对话内容。 */

import type { ApiEnv } from '@chat/config';
import { AuditAction } from '@chat/database';
import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { API_ENV } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class DataRetentionService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer?: NodeJS.Timeout;
  private cleaning = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_ENV) private readonly environment: ApiEnv,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(
      () => void this.cleanupOnce(),
      this.environment.DATA_RETENTION_CLEANUP_INTERVAL_MS,
    );
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async cleanupOnce(now = new Date()): Promise<number> {
    if (this.cleaning) return 0;
    this.cleaning = true;
    try {
      const daysAgo = (days: number) =>
        new Date(now.getTime() - days * 86_400_000);
      const securityActions = [
        AuditAction.SESSION_REJECTED,
        AuditAction.CONVERSATION_DELETED,
      ];
      const [outbox, regularAudit, securityAudit, usage] = await Promise.all([
        this.prisma.outboxEvent.deleteMany({
          where: {
            publishedAt: {
              lt: daysAgo(this.environment.OUTBOX_RETENTION_DAYS),
            },
          },
        }),
        this.prisma.auditLog.deleteMany({
          where: {
            action: { notIn: securityActions },
            createdAt: {
              lt: daysAgo(this.environment.AUDIT_RETENTION_DAYS),
            },
          },
        }),
        this.prisma.auditLog.deleteMany({
          where: {
            action: { in: securityActions },
            createdAt: {
              lt: daysAgo(this.environment.SECURITY_AUDIT_RETENTION_DAYS),
            },
          },
        }),
        this.prisma.usageRecord.deleteMany({
          where: {
            createdAt: {
              lt: daysAgo(this.environment.USAGE_RETENTION_DAYS),
            },
          },
        }),
      ]);
      return (
        outbox.count + regularAudit.count + securityAudit.count + usage.count
      );
    } finally {
      this.cleaning = false;
    }
  }
}
