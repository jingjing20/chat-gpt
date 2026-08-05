'use client';

import {
  createConversation,
  getCurrentUser,
  listConversations,
  logout,
} from '@/lib/chat-api';
import { queryKeys } from '@/lib/query-keys';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

export function ChatShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const params = useParams<{ conversationId?: string }>();
  const queryClient = useQueryClient();
  const userQuery = useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: getCurrentUser,
    retry: false,
  });
  const conversationsQuery = useQuery({
    queryKey: queryKeys.conversations.list(false),
    queryFn: () => listConversations(false),
    enabled: userQuery.isSuccess,
  });
  const createMutation = useMutation({
    mutationFn: () => createConversation(),
    onSuccess: async (conversation) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.all,
      });
      router.push(`/chat/${conversation.id}`);
    },
  });
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
      router.replace('/login');
    },
  });

  useEffect(() => {
    if (userQuery.isError) router.replace('/login');
  }, [router, userQuery.isError]);

  if (userQuery.isPending) {
    return <main className="centered-state">正在恢复登录状态…</main>;
  }
  if (userQuery.isError) return null;

  return (
    <main className="chat-shell">
      <aside className="sidebar">
        <div className="sidebar-heading">
          <Link href="/chat" className="brand-link">
            <span className="brand-orb" aria-hidden="true" />
            Concurrent
          </Link>
          <button
            aria-label="新建对话"
            className="icon-button"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
            type="button"
          >
            ＋
          </button>
        </div>
        <nav className="conversation-nav" aria-label="对话列表">
          <p className="nav-label">最近对话</p>
          {conversationsQuery.data?.items.map((conversation) => (
            <Link
              className={
                params.conversationId === conversation.id
                  ? 'conversation-link active'
                  : 'conversation-link'
              }
              href={`/chat/${conversation.id}`}
              key={conversation.id}
            >
              <span>{conversation.title}</span>
              <time dateTime={conversation.updatedAt}>
                {new Intl.DateTimeFormat('zh-CN', {
                  month: 'numeric',
                  day: 'numeric',
                }).format(new Date(conversation.updatedAt))}
              </time>
            </Link>
          ))}
          {conversationsQuery.isSuccess &&
          conversationsQuery.data.items.length === 0 ? (
            <p className="empty-nav">还没有对话，点击右上角开始。</p>
          ) : null}
        </nav>
        <div className="account-row">
          <div>
            <span className="avatar">
              {userQuery.data.email[0]?.toUpperCase()}
            </span>
            <span className="account-email">{userQuery.data.email}</span>
          </div>
          <button
            className="text-button"
            disabled={logoutMutation.isPending}
            onClick={() => logoutMutation.mutate()}
            type="button"
          >
            退出
          </button>
        </div>
      </aside>
      <section className="chat-stage">{children}</section>
    </main>
  );
}
