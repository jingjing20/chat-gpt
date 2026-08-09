'use client';

import {
  selectConversationActivity,
  useGenerationStore,
} from '@/lib/generation-store';
import type { ConversationResponse } from '@chat/contracts';
import Link from 'next/link';
import { useShallow } from 'zustand/react/shallow';
import { ConversationActions } from './conversation-actions';

export function ConversationNavLink({
  conversation,
  isActive,
}: {
  conversation: ConversationResponse;
  isActive: boolean;
}) {
  const activity = useGenerationStore(
    useShallow(selectConversationActivity(conversation.id)),
  );
  const isGenerating = activity.activeCount > 0;

  return (
    <div
      className={
        isActive ? 'conversation-nav-item active' : 'conversation-nav-item'
      }
    >
      <Link className="conversation-link" href={`/chat/${conversation.id}`}>
        <span className="conversation-link-title">
          {conversation.title}
          {isGenerating ? (
            <i aria-label="正在生成" className="generation-dot" />
          ) : conversation.hasUnread && !isActive ? (
            <i aria-label="有未读回答" className="unread-dot" />
          ) : null}
        </span>
        <time dateTime={conversation.updatedAt}>
          {new Intl.DateTimeFormat('zh-CN', {
            month: 'numeric',
            day: 'numeric',
          }).format(new Date(conversation.updatedAt))}
        </time>
      </Link>
      <ConversationActions conversation={conversation} isActive={isActive} />
    </div>
  );
}
