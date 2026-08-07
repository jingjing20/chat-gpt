'use client';

import {
  archiveConversation,
  cancelGeneration,
  createGeneration,
  getConversation,
  listMessages,
  markConversationRead,
  renameConversation,
  saveScrollPosition,
} from '@/lib/chat-api';
import { ApiClientError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, type FormEvent } from 'react';
import { SafeMarkdown } from './safe-markdown';
import {
  isGenerationActive,
  selectConversationGenerations,
  useGenerationStore,
} from '@/lib/generation-store';
import { useShallow } from 'zustand/react/shallow';

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
  const content = useGenerationStore(
    (state) => state.drafts[conversationId] ?? '',
  );
  const overlays = useGenerationStore(
    useShallow(selectConversationGenerations(conversationId)),
  );
  const activeOverlays = overlays.filter((generation) =>
    isGenerationActive(generation.status),
  );
  const terminalSignature = overlays
    .filter((generation) => !isGenerationActive(generation.status))
    .map((generation) => `${generation.generationId}:${generation.status}`)
    .join('|');
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
              generationId: overlay.generationId,
            }
          : message;
      });
  }, [messagesQuery.data, overlays]);
  const sendMutation = useMutation({
    mutationFn: (message: string) => createGeneration(conversationId, message),
    onMutate: (message) => {
      useGenerationStore.getState().clearDraft(conversationId);
      return { message };
    },
    onError: (_error, _message, context) => {
      if (
        context?.message &&
        !useGenerationStore.getState().drafts[conversationId]
      ) {
        useGenerationStore.getState().setDraft(conversationId, context.message);
      }
    },
    onSuccess: async (result) => {
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
  const cancelMutation = useMutation({
    mutationFn: (generationId: string) =>
      cancelGeneration(conversationId, generationId),
    onSuccess: (generation) => {
      const local = useGenerationStore.getState().generations[generation.id];
      if (local?.conversationId === conversationId) {
        useGenerationStore.setState((store) => ({
          generations: {
            ...store.generations,
            [generation.id]: { ...local, status: generation.status },
          },
        }));
      }
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
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.all,
      });
    });
  }, [conversationId, queryClient, terminalSignature]);

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

  useEffect(() => {
    const viewport = viewportRef.current;
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      if (viewport) {
        void saveScrollPosition(
          conversationId,
          Math.max(0, Math.round(viewport.scrollTop)),
        );
      }
    };
  }, [conversationId]);

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
                {message.status === 'QUEUED' ||
                message.status === 'PENDING' ||
                message.status === 'STARTING' ||
                message.status === 'STREAMING' ? (
                  <span className="streaming-indicator">
                    {message.status === 'PENDING' || message.status === 'QUEUED'
                      ? '排队中…'
                      : '生成中…'}
                  </span>
                ) : null}
                {'generationId' in message &&
                typeof message.generationId === 'string' &&
                (message.status === 'QUEUED' ||
                  message.status === 'STARTING' ||
                  message.status === 'STREAMING' ||
                  message.status === 'CANCEL_REQUESTED') ? (
                  <button
                    className="stop-generation"
                    disabled={
                      cancelMutation.isPending &&
                      cancelMutation.variables === message.generationId
                    }
                    onClick={() => cancelMutation.mutate(message.generationId)}
                    type="button"
                  >
                    停止这项生成
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
      <form className="composer" onSubmit={submit}>
        <div className="composer-status" aria-live="polite">
          {activeOverlays.some((generation) => generation.status === 'QUEUED')
            ? '任务已进入队列，切换对话不会中断。'
            : activeOverlays.length > 0
              ? `此对话有 ${activeOverlays.length} 项任务正在运行。`
              : sendMutation.error instanceof ApiClientError &&
                  sendMutation.error.code === 'USER_CONCURRENCY_LIMIT'
                ? sendMutation.error.message
                : null}
        </div>
        <textarea
          aria-label="消息内容"
          maxLength={20_000}
          onChange={(event) =>
            useGenerationStore
              .getState()
              .setDraft(conversationId, event.target.value)
          }
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
