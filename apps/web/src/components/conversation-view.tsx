'use client';

import {
  cancelGeneration,
  createGeneration,
  getConversation,
  listMessages,
  markConversationRead,
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
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { SafeMarkdown } from './safe-markdown';
import { ReasoningPanel } from './reasoning-panel';
import {
  isGenerationActive,
  selectConversationGenerations,
  useGenerationStore,
} from '@/lib/generation-store';
import { useShallow } from 'zustand/react/shallow';
import { ArrowDown, ArrowUp, Square } from 'lucide-react';
import { AnswerActions } from './answer-actions';
import {
  isViewportNearBottom,
  shouldShowScrollToBottom,
} from '@/lib/scroll-follow';

export function ConversationView({
  conversationId,
}: {
  conversationId: string;
}) {
  const queryClient = useQueryClient();
  const viewportRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const restoredConversationRef = useRef<string | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldFollowStreamingRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const content = useGenerationStore(
    (state) => state.drafts[conversationId] ?? '',
  );
  const connectionStatus = useGenerationStore(
    (state) => state.connectionStatus,
  );
  const overlays = useGenerationStore(
    useShallow(selectConversationGenerations(conversationId)),
  );
  const activeOverlays = overlays.filter((generation) =>
    isGenerationActive(generation.status),
  );
  const streamingSignature = activeOverlays
    .map(
      (generation) =>
        `${generation.generationId}:${generation.content.length}:${generation.reasoningContent.length}:${generation.status}`,
    )
    .join('|');
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
        if (viewport) {
          shouldFollowStreamingRef.current = true;
          viewport.scrollTop = viewport.scrollHeight;
        }
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
  const composerStatus = activeOverlays.some(
    (generation) => generation.status === 'QUEUED',
  )
    ? '任务已进入队列，切换对话不会中断。'
    : activeOverlays.length > 0
      ? `此对话有 ${activeOverlays.length} 项任务正在运行。`
      : connectionStatus === 'disconnected'
        ? '实时连接已断开，正在重连；已生成内容不会丢失。'
        : sendMutationErrorMessage();
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
    shouldFollowStreamingRef.current = isViewportNearBottom(viewport);
    setShowScrollToBottom(shouldShowScrollToBottom(viewport));
  }, [conversationId, detailQuery.data, messagesQuery.isPending]);

  useLayoutEffect(() => {
    if (!streamingSignature) return;
    const viewport = viewportRef.current;
    if (viewport && shouldFollowStreamingRef.current) {
      viewport.scrollTop = viewport.scrollHeight;
    } else if (viewport) {
      setShowScrollToBottom(shouldShowScrollToBottom(viewport));
    }
  }, [messages.length, streamingSignature]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [content]);

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
    const viewport = viewportRef.current;
    if (viewport) {
      shouldFollowStreamingRef.current = isViewportNearBottom(viewport);
      setShowScrollToBottom(shouldShowScrollToBottom(viewport));
    }
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

  function sendMutationErrorMessage() {
    return sendMutation.error instanceof ApiClientError &&
      sendMutation.error.code === 'USER_CONCURRENCY_LIMIT'
      ? sendMutation.error.message
      : null;
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
        <h1>{detailQuery.data.title}</h1>
        <span className="conversation-mode">
          <i aria-hidden="true" />
          DeepSeek
        </span>
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
                aria-label={message.role === 'USER' ? '你的消息' : '助手回答'}
                className={`message ${message.role.toLowerCase()}`}
                key={message.id}
              >
                <div className="message-content">
                  {message.reasoningContent ? (
                    <ReasoningPanel
                      content={message.reasoningContent}
                      status={message.status}
                    />
                  ) : null}
                  <SafeMarkdown content={message.content} />
                  {message.status === 'QUEUED' ||
                  message.status === 'PENDING' ||
                  message.status === 'STARTING' ||
                  message.status === 'STREAMING' ? (
                    <span className="streaming-indicator">
                      {message.status === 'PENDING' ||
                      message.status === 'QUEUED'
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
                      onClick={() =>
                        cancelMutation.mutate(message.generationId)
                      }
                      type="button"
                    >
                      <Square aria-hidden="true" size={10} />
                      停止生成
                    </button>
                  ) : null}
                  {message.role === 'ASSISTANT' &&
                  message.status === 'COMPLETED' &&
                  message.content ? (
                    <AnswerActions content={message.content} />
                  ) : null}
                  {message.role === 'ASSISTANT' &&
                  (message.status === 'FAILED' ||
                    message.status === 'CANCELLED') ? (
                    <div className="generation-terminal-state">
                      <span>
                        {message.status === 'CANCELLED'
                          ? '生成已取消。'
                          : 'error' in message &&
                              typeof message.error === 'string'
                            ? message.error
                            : '生成失败，已保留收到的部分内容。'}
                      </span>
                      {message.status === 'FAILED' ? (
                        <button
                          onClick={() => {
                            const index = messages.findIndex(
                              (item) => item.id === message.id,
                            );
                            const request =
                              index > 0 ? messages[index - 1] : undefined;
                            if (request?.role === 'USER') {
                              useGenerationStore
                                .getState()
                                .setDraft(conversationId, request.content);
                              textareaRef.current?.focus();
                            }
                          }}
                          type="button"
                        >
                          填入原问题后重试
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
      <button
        aria-label="回到最新消息"
        className={
          showScrollToBottom ? 'scroll-to-bottom visible' : 'scroll-to-bottom'
        }
        onClick={() => {
          const viewport = viewportRef.current;
          if (!viewport) return;
          shouldFollowStreamingRef.current = true;
          viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
        }}
        tabIndex={showScrollToBottom ? 0 : -1}
        title="回到最新消息"
        type="button"
      >
        <ArrowDown aria-hidden="true" size={18} />
      </button>
      <form className="composer" onSubmit={submit}>
        {composerStatus ? (
          <div className="composer-status" aria-live="polite">
            {composerStatus}
          </div>
        ) : null}
        <div className="composer-panel">
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
            placeholder="给助手发送消息"
            ref={textareaRef}
            rows={1}
            value={content}
          />
          <button
            aria-label="发送消息"
            disabled={sendMutation.isPending || !content.trim()}
            type="submit"
          >
            <ArrowUp aria-hidden="true" size={19} />
          </button>
          <p>Enter 发送 · Shift + Enter 换行</p>
        </div>
      </form>
    </div>
  );
}
