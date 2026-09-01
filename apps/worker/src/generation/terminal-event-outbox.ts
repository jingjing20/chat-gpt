import type {
  GenerationTerminalOutboxPayload,
  GenerationEventType,
} from '@chat/contracts';
import type { Prisma } from '@chat/database';

type TerminalEventType = Extract<
  GenerationEventType,
  'generation.completed' | 'generation.failed' | 'generation.cancelled'
>;

/** 将 Generation 终态通知与业务终态写入同一个 PostgreSQL 事务。 */
export async function enqueueTerminalEvent(
  transaction: Prisma.TransactionClient,
  input: {
    userId: string;
    conversationId: string;
    generationId: string;
    messageId: string;
    type: TerminalEventType;
    payload: Record<string, unknown>;
    content: string;
    reasoningContent: string | null;
    status: 'COMPLETED' | 'FAILED' | 'CANCELLED';
  },
): Promise<void> {
  const payload: GenerationTerminalOutboxPayload = {
    version: 1,
    userId: input.userId,
    conversationId: input.conversationId,
    generationId: input.generationId,
    messageId: input.messageId,
    type: input.type,
    payload: input.payload,
    state: {
      content: input.content,
      reasoningContent: input.reasoningContent,
      status: input.status,
    },
  };
  await transaction.outboxEvent.create({
    data: {
      aggregateType: 'generation',
      aggregateId: input.generationId,
      type: input.type,
      payload: payload as Prisma.InputJsonObject,
    },
  });
}
