'use client';

import {
  conversationTimestamp,
  getCurrentUser,
  listConversations,
  logout,
} from '@/lib/chat-api';
import { queryKeys } from '@/lib/query-keys';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useGenerationStore } from '@/lib/generation-store';
import { ConversationNavLink } from './conversation-nav-link';
import {
  LogOut,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from 'lucide-react';
import type { ConversationResponse } from '@chat/contracts';

function conversationGroup(dateValue: string) {
  const now = new Date();
  const date = new Date(dateValue);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.floor((today.getTime() - target.getTime()) / 86_400_000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return '7 天内';
  if (days < 30) return '30 天内';
  return '更早';
}

function groupConversations(conversations: ConversationResponse[]) {
  const groups = new Map<string, ConversationResponse[]>();
  for (const conversation of conversations) {
    const label = conversationGroup(conversationTimestamp(conversation));
    groups.set(label, [...(groups.get(label) ?? []), conversation]);
  }
  return [...groups.entries()];
}

export function ChatShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const params = useParams<{ conversationId?: string }>();
  const queryClient = useQueryClient();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
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
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      useGenerationStore.getState().clear();
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
    <main
      className={
        isSidebarCollapsed ? 'chat-shell sidebar-collapsed' : 'chat-shell'
      }
    >
      <aside className="sidebar">
        <div className="sidebar-heading">
          <Link href="/chat" className="brand-link" title="Lucidra">
            <Image
              alt=""
              className="brand-logo"
              height={27}
              priority
              src="/lucidra-mark.svg"
              width={27}
            />
            <span className="brand-name">Lucidra</span>
          </Link>
          <button
            aria-label={isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            className="sidebar-toggle"
            onClick={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
            title={isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            type="button"
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen aria-hidden="true" size={18} />
            ) : (
              <PanelLeftClose aria-hidden="true" size={18} />
            )}
          </button>
        </div>
        <button
          className="new-conversation-button"
          onClick={() => router.push('/chat')}
          type="button"
        >
          <MessageSquarePlus aria-hidden="true" size={16} />
          <span>新建对话</span>
        </button>
        <nav className="conversation-nav" aria-label="对话列表">
          {groupConversations(conversationsQuery.data?.items ?? []).map(
            ([label, conversations]) => (
              <section className="conversation-group" key={label}>
                <p className="nav-label">{label}</p>
                {conversations.map((conversation) => (
                  <ConversationNavLink
                    conversation={conversation}
                    isActive={params.conversationId === conversation.id}
                    key={conversation.id}
                  />
                ))}
              </section>
            ),
          )}
          {conversationsQuery.isSuccess &&
          conversationsQuery.data.items.length === 0 ? (
            <p className="empty-nav">还没有对话，从首页输入一个问题开始。</p>
          ) : null}
        </nav>
        <div className="account-row" title={userQuery.data.email}>
          <div className="account-identity">
            <span className="avatar">
              {userQuery.data.email[0]?.toUpperCase()}
            </span>
            <span className="account-name">
              {userQuery.data.email.split('@')[0]}
            </span>
          </div>
          <div className="account-actions">
            <Link
              aria-label="设置"
              className="settings-link"
              href="/settings"
              title="设置"
            >
              <Settings aria-hidden="true" size={16} />
              <span>设置</span>
            </Link>
            <button
              aria-label="退出登录"
              className="logout-button"
              disabled={logoutMutation.isPending}
              onClick={() => logoutMutation.mutate()}
              title="退出登录"
              type="button"
            >
              <LogOut aria-hidden="true" size={16} />
              <span>{logoutMutation.isPending ? '正在退出…' : '退出登录'}</span>
            </button>
          </div>
        </div>
      </aside>
      <section className="chat-stage" key={params.conversationId ?? 'empty'}>
        {children}
      </section>
    </main>
  );
}
