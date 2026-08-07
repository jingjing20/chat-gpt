'use client';

import {
  archiveConversation,
  createGeneration,
  getConversation,
  listMessages,
  markConversationRead,
  renameConversation,
  saveScrollPosition,
} from '@/lib/chat-api';
import { queryKeys } from '@/lib/query-keys';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { SafeMarkdown } from './safe-markdown';
import { useGenerationStore } from '@/lib/generation-store';

export function ConversationView({
  conversationId,
}: {
  conversationId: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const viewportRef = useRef<HTMLDivElement>(null);
  const restoredConversationRef = useRef<string | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [content, setContent] = useState('');
  const generations = useGenerationStore((state) => state.generations);
  const overlays = useMemo(
    () =>
      Object.values(generations).filter(
        (generation) => generation.conversationId === conversationId,
      ),
    [conversationId, generations],
  );
  const detailQuery = useQuery({
    queryKey: queryKeys.conversations.detail(conversationId),
    queryFn: () => getConversation(conversationId),
  });
  const messagesQuery = useInfiniteQuery({
    queryKey: queryKeys.conversations.messages(conversationId),
    queryFn: ({ pageParam }) => listMessages(conversationId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const messages = useMemo(() => {
    const overlayByMessage = new Map(
      overlays.map((overlay) => [overlay.messageId, overlay]),
    );
    return (messagesQuery.data?.pages.flatMap((page) => page.items) ?? [])
      .slice()
      .reverse()
      .map((message) => {
        const overlay = overlayByMessage.get(message.id);
        return overlay
          ? {
              ...message,
              content: overlay.content,
              reasoningContent: overlay.reasoningContent || null,
              status: overlay.status,
            }
          : message;
      });
  }, [messagesQuery.data, overlays]);
  const sendMutation = useMutation({
    mutationFn: (message: string) => createGeneration(conversationId, message),
    onSuccess: async (result) => {
      setContent('');
      useGenerationStore.getState().register({
        generationId: result.generation.id,
        conversationId: result.generation.conversationId,
        messageId: result.generation.responseMessageId,
        status: result.generation.status,
        content: '',
        reasoningContent: '',
        lastAppliedSequence: result.generation.lastSequence,
        syncState: 'synced',
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.conversations.messages(conversationId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.conversations.detail(conversationId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.conversations.all,
        }),
      ]);
      requestAnimationFrame(() => {
        const viewport = viewportRef.current;
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
      });
    },
  });
  const archiveMutation = useMutation({
    mutationFn: () => archiveConversation(conversationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.all,
      });
      router.replace('/chat');
    },
  });
  const renameMutation = useMutation({
    mutationFn: (title: string) => renameConversation(conversationId, title),
    onSuccess: async (conversation) => {
      queryClient.setQueryData(
        queryKeys.conversations.detail(conversationId),
        conversation,
      );
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.all,
      });
    },
  });

  useEffect(() => {
    void markConversationRead(conversationId).then((conversation) => {
      queryClient.setQueryData(
        queryKeys.conversations.detail(conversationId),
        conversation,
      );
    });
  }, [conversationId, queryClient]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (
      !viewport ||
      !detailQuery.data ||
      messagesQuery.isPending ||
      restoredConversationRef.current === conversationId
    ) {
      return;
    }
    restoredConversationRef.current = conversationId;
    viewport.scrollTop = detailQuery.data.scrollOffset;
  }, [conversationId, detailQuery.data, messagesQuery.isPending]);

  useEffect(
    () => () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    },
    [],
  );

  function handleScroll() {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      const scrollOffset = Math.max(
        0,
        Math.round(viewportRef.current?.scrollTop ?? 0),
      );
      void saveScrollPosition(conversationId, scrollOffset);
    }, 250);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = content.trim();
    if (message) sendMutation.mutate(message);
  }

  function promptForTitle() {
    const title = window.prompt('输入新的对话名称', detailQuery.data?.title);
    if (title?.trim()) renameMutation.mutate(title.trim());
  }

  if (detailQuery.isPending || messagesQuery.isPending) {
    return <div className="centered-state">正在载入对话…</div>;
  }
  if (detailQuery.isError || messagesQuery.isError) {
    return <div className="centered-state">无法读取这段对话。</div>;
  }

  return (
    <div className="conversation-view">
      <header className="conversation-header">
        <div>
          <p>持久化对话</p>
          <h1>{detailQuery.data.title}</h1>
        </div>
        <div className="header-actions">
          <button
            className="text-button"
            onClick={promptForTitle}
            type="button"
          >
            重命名
          </button>
          <button
            className="text-button danger"
            disabled={archiveMutation.isPending}
            onClick={() => archiveMutation.mutate()}
            type="button"
          >
            归档
          </button>
        </div>
      </header>
      <div
        className="message-viewport"
        onScroll={handleScroll}
        ref={viewportRef}
      >
        {messagesQuery.hasNextPage ? (
          <button
            className="load-older"
            disabled={messagesQuery.isFetchingNextPage}
            onClick={() => messagesQuery.fetchNextPage()}
            type="button"
          >
            {messagesQuery.isFetchingNextPage ? '载入中…' : '载入更早消息'}
          </button>
        ) : null}
        {messages.length === 0 ? (
          <div className="message-empty">
            <h2>这是一段空白对话</h2>
            <p>输入内容后，回答会实时显示在这里。</p>
          </div>
        ) : (
          <div className="message-list">
            {messages.map((message) => (
              <article
                className={`message ${message.role.toLowerCase()}`}
                key={message.id}
              >
                <div className="message-role">
                  {message.role === 'USER' ? '你' : 'Assistant'}
                </div>
                {message.reasoningContent ? (
                  <details className="reasoning-block">
                    <summary>推理过程</summary>
                    <SafeMarkdown content={message.reasoningContent} />
                  </details>
                ) : null}
                <SafeMarkdown content={message.content} />
                {message.status === 'PENDING' ||
                message.status === 'STARTING' ||
                message.status === 'STREAMING' ? (
                  <span className="streaming-indicator">生成中…</span>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
      <form className="composer" onSubmit={submit}>
        <textarea
          aria-label="消息内容"
          maxLength={20_000}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="输入消息，Enter 发送，Shift + Enter 换行"
          rows={1}
          value={content}
        />
        <button
          aria-label="发送消息"
          disabled={sendMutation.isPending || !content.trim()}
          type="submit"
        >
          ↑
        </button>
      </form>
    </div>
  );
}
