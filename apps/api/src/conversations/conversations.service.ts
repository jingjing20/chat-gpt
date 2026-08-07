import type {
  ConversationListResponse,
  ConversationResponse,
  CreateMessageResponse,
  MessagePageResponse,
  MessageResponse,
} from '@chat/contracts';
import { MessageRole, MessageStatus, Prisma } from '@chat/database';
import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ApiException } from '../http/api-exception';

const STATIC_ASSISTANT_MESSAGE =
  '这是阶段 2 的静态回复。消息已经安全地保存，可以继续输入来测试长对话列表。';

interface MessageCursor {
  id: string;
  createdAt: string;
}

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, title: string): Promise<ConversationResponse> {
    const now = new Date();
    const conversation = await this.prisma.conversation.create({
      data: {
        ownerUserId: userId,
        title,
        userStates: { create: { userId, lastReadAt: now } },
      },
      include: { userStates: { where: { userId } } },
    });
    return this.toConversation(conversation, conversation.userStates[0]);
  }

  async list(
    userId: string,
    archived: boolean,
  ): Promise<ConversationListResponse> {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        ownerUserId: userId,
        userStates: {
          some: {
            userId,
            archivedAt: archived ? { not: null } : null,
          },
        },
      },
      include: { userStates: { where: { userId }, take: 1 } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    return {
      items: conversations.map((conversation) =>
        this.toConversation(conversation, conversation.userStates[0]),
      ),
    };
  }

  async get(
    userId: string,
    conversationId: string,
  ): Promise<ConversationResponse> {
    const conversation = await this.findScoped(userId, conversationId);
    return this.toConversation(conversation, conversation.userStates[0]);
  }

  async rename(
    userId: string,
    conversationId: string,
    title: string,
  ): Promise<ConversationResponse> {
    await this.requireScoped(userId, conversationId);
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { title },
    });
    return this.get(userId, conversationId);
  }

  async archive(
    userId: string,
    conversationId: string,
  ): Promise<ConversationResponse> {
    await this.requireScoped(userId, conversationId);
    await this.prisma.conversationUserState.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { archivedAt: new Date() },
    });
    return this.get(userId, conversationId);
  }

  async markRead(
    userId: string,
    conversationId: string,
  ): Promise<ConversationResponse> {
    await this.requireScoped(userId, conversationId);
    await this.prisma.conversationUserState.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: new Date() },
    });
    return this.get(userId, conversationId);
  }

  async updateScrollPosition(
    userId: string,
    conversationId: string,
    scrollOffset: number,
  ): Promise<ConversationResponse> {
    await this.requireScoped(userId, conversationId);
    await this.prisma.conversationUserState.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { scrollOffset },
    });
    return this.get(userId, conversationId);
  }

  async createMessages(
    userId: string,
    conversationId: string,
    content: string,
  ): Promise<CreateMessageResponse> {
    await this.requireScoped(userId, conversationId);
    const userCreatedAt = new Date();
    const assistantCreatedAt = new Date(userCreatedAt.getTime() + 1);
    const [userMessage, assistantMessage] = await this.prisma.$transaction(
      async (transaction) => {
        const createdUserMessage = await transaction.message.create({
          data: {
            conversationId,
            authorUserId: userId,
            role: MessageRole.USER,
            status: MessageStatus.COMPLETED,
            content,
            createdAt: userCreatedAt,
            completedAt: userCreatedAt,
          },
        });
        const createdAssistantMessage = await transaction.message.create({
          data: {
            conversationId,
            role: MessageRole.ASSISTANT,
            status: MessageStatus.COMPLETED,
            content: STATIC_ASSISTANT_MESSAGE,
            createdAt: assistantCreatedAt,
            completedAt: assistantCreatedAt,
          },
        });
        await transaction.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: assistantCreatedAt },
        });
        return [createdUserMessage, createdAssistantMessage] as const;
      },
    );
    return {
      userMessage: this.toMessage(userMessage),
      assistantMessage: this.toMessage(assistantMessage),
    };
  }

  async listMessages(
    userId: string,
    conversationId: string,
    limit: number,
    encodedCursor?: string,
  ): Promise<MessagePageResponse> {
    await this.requireScoped(userId, conversationId);
    const cursor = encodedCursor ? this.decodeCursor(encodedCursor) : null;
    const cursorWhere: Prisma.MessageWhereInput | undefined = cursor
      ? {
          OR: [
            { createdAt: { lt: new Date(cursor.createdAt) } },
            {
              createdAt: new Date(cursor.createdAt),
              id: { lt: cursor.id },
            },
          ],
        }
      : undefined;
    const messages = await this.prisma.message.findMany({
      where: { conversationId, ...cursorWhere },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = messages.length > limit;
    const items = messages.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map((message) => this.toMessage(message)),
      nextCursor:
        hasMore && last
          ? this.encodeCursor({
              id: last.id,
              createdAt: last.createdAt.toISOString(),
            })
          : null,
    };
  }

  private async requireScoped(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    await this.findScoped(userId, conversationId);
  }

  private async findScoped(userId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        ownerUserId: userId,
        userStates: { some: { userId } },
      },
      include: { userStates: { where: { userId }, take: 1 } },
    });
    if (!conversation) {
      throw new ApiException('NOT_FOUND', '对话不存在', HttpStatus.NOT_FOUND);
    }
    return conversation;
  }

  private toConversation(
    conversation: {
      id: string;
      title: string;
      lastMessageAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
    state: {
      archivedAt: Date | null;
      lastReadAt: Date | null;
      scrollOffset: number;
    },
  ): ConversationResponse {
    return {
      id: conversation.id,
      title: conversation.title,
      archivedAt: state.archivedAt?.toISOString() ?? null,
      lastReadAt: state.lastReadAt?.toISOString() ?? null,
      scrollOffset: state.scrollOffset,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }

  private toMessage(message: {
    id: string;
    conversationId: string;
    role: MessageRole;
    status: MessageStatus;
    content: string;
    reasoningContent: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }): MessageResponse {
    return {
      id: message.id,
      conversationId: message.conversationId,
      role: message.role,
      status: message.status,
      content: message.content,
      reasoningContent: message.reasoningContent,
      createdAt: message.createdAt.toISOString(),
      completedAt: message.completedAt?.toISOString() ?? null,
    };
  }

  private encodeCursor(cursor: MessageCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  private decodeCursor(value: string): MessageCursor {
    try {
      const parsed = JSON.parse(
        Buffer.from(value, 'base64url').toString('utf8'),
      ) as Partial<MessageCursor>;
      if (
        typeof parsed.id !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(parsed.id) ||
        typeof parsed.createdAt !== 'string' ||
        Number.isNaN(Date.parse(parsed.createdAt))
      ) {
        throw new Error('游标格式错误');
      }
      return { id: parsed.id, createdAt: parsed.createdAt };
    } catch {
      throw new ApiException(
        'VALIDATION_ERROR',
        '消息游标不合法',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }
}
