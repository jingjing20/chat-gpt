'use client';

import {
  cancelGeneration,
  createGenerationOperation,
  createGeneration,
  DEFAULT_GENERATION_MODES,
  getConversation,
  listMessages,
  markConversationRead,
  retryGeneration,
  saveScrollPosition,
  type GenerationOperation,
  type GenerationModes,
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
  useCallback,
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
import { ArrowDown, ArrowUp, ListChecks, Square } from 'lucide-react';
import { AnswerActions } from './answer-actions';
import {
  isViewportNearBottom,
  resolveConversationScrollTarget,
  shouldShowScrollToBottom,
} from '@/lib/scroll-follow';
import type { ConversationResponse } from '@chat/contracts';
import { GenerationModeToggles } from './generation-mode-toggles';
import { TaskSetupPanel } from './task-setup-panel';
import { stripLegacyTaskQuestionnaireInstruction } from '@/lib/task-questionnaire';

/**
 * 把服务端消息缓存与当前对话的实时 overlay 合并，仅渲染该对话的生成状态。
 */
export function ConversationView({
  conversationId,
  taskSetup,
}: {
  conversationId: string;
  taskSetup?: string;
}) {
  const queryClient = useQueryClient();
  const viewportRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const restoredConversationRef = useRef<string | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScrollOffsetRef = useRef<number | null>(null);
  const restorationFrameRef = useRef<number | null>(null);
  const restorationPendingRef = useRef(false);
  const ignoredProgrammaticScrollOffsetRef = useRef<number | null>(null);
  const persistedScrollOffsetRef = useRef<number | null>(null);
  const shouldFollowStreamingRef = useRef(true);
  const pendingOperationRef = useRef<{
    message: string;
    operation: GenerationOperation;
    modes: GenerationModes;
  } | null>(null);
  const [modes, setModes] = useState<GenerationModes>(DEFAULT_GENERATION_MODES);
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
  /**
   * Zustand 实时内容覆盖 React Query 中的 assistant 占位消息，终态再由数据库收敛。
   */
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
      })
      .map((message) =>
        message.role === 'USER'
          ? {
              ...message,
              content: stripLegacyTaskQuestionnaireInstruction(message.content),
            }
          : message,
      )
      .filter(
        (message) =>
          message.role !== 'SYSTEM' &&
          (message.content ||
            ['PENDING', 'QUEUED', 'STARTING', 'STREAMING'].includes(
              message.status,
            )),
      );
  }, [messagesQuery.data, overlays]);
  const questionnaireMessage = taskSetup
    ? [...messages].reverse().find((message) => message.role === 'ASSISTANT')
    : undefined;
  const questionnaireGenerating = Boolean(
    taskSetup &&
    (!questionnaireMessage ||
      ['PENDING', 'QUEUED', 'STARTING', 'STREAMING'].includes(
        questionnaireMessage.status,
      )),
  );
  const visibleMessages = taskSetup
    ? messages.filter((message) => message.role === 'USER')
    : messages;
  const persistScrollPosition = useCallback(
    (scrollOffset: number) => {
      if (persistedScrollOffsetRef.current === scrollOffset) return;
      const queryKey = queryKeys.conversations.detail(conversationId);
      const previousConversation =
        queryClient.getQueryData<ConversationResponse>(queryKey);
      const previousScrollOffset = persistedScrollOffsetRef.current;
      persistedScrollOffsetRef.current = scrollOffset;
      queryClient.setQueryData<ConversationResponse>(
        queryKey,
        (conversation) =>
          conversation ? { ...conversation, scrollOffset } : conversation,
      );
      void saveScrollPosition(conversationId, scrollOffset).catch(() => {
        const currentConversation =
          queryClient.getQueryData<ConversationResponse>(queryKey);
        if (currentConversation?.scrollOffset !== scrollOffset) return;
        persistedScrollOffsetRef.current = previousScrollOffset;
        queryClient.setQueryData(queryKey, previousConversation);
      });
    },
    [conversationId, queryClient],
  );
  const sendMutation = useMutation({
    mutationFn: (input: {
      message: string;
      operation: GenerationOperation;
      modes: GenerationModes;
    }) =>
      createGeneration(
        conversationId,
        input.message,
        input.operation,
        input.modes,
      ),
    onMutate: (input) => {
      useGenerationStore.getState().clearDraft(conversationId);
      return { message: input.message };
    },
    onError: (_error, _input, context) => {
      if (
        context?.message &&
        !useGenerationStore.getState().drafts[conversationId]
      ) {
        useGenerationStore.getState().setDraft(conversationId, context.message);
      }
    },
    onSuccess: async (result) => {
      pendingOperationRef.current = null;
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
  const retryMutation = useMutation({
    mutationFn: (generationId: string) => retryGeneration(generationId),
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
          queryKey: queryKeys.conversations.all,
        }),
      ]);
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
  /**
   * 切回活动对话时定位最新内容，否则恢复用户上次保存的阅读位置。
   */
  useEffect(() => {
    void markConversationRead(conversationId)
      .then((conversation) => {
        queryClient.setQueryData<ConversationResponse>(
          queryKeys.conversations.detail(conversationId),
          (currentConversation) => ({
            ...conversation,
            scrollOffset:
              currentConversation?.scrollOffset ?? conversation.scrollOffset,
          }),
        );
        void queryClient.invalidateQueries({
          queryKey: queryKeys.conversations.all,
        });
      })
      .catch(() => {
        // 断网期间读回执失败不影响事件恢复，重新进入对话时会再次提交。
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
    const targetScrollOffset = resolveConversationScrollTarget({
      clientHeight: viewport.clientHeight,
      hasActiveGeneration: activeOverlays.length > 0,
      savedScrollOffset: detailQuery.data.scrollOffset,
      scrollHeight: viewport.scrollHeight,
    });
    let attempts = 0;
    restorationPendingRef.current = true;
    persistedScrollOffsetRef.current = targetScrollOffset;

    const restore = () => {
      viewport.scrollTop = targetScrollOffset;
      const actualScrollOffset = Math.max(0, Math.round(viewport.scrollTop));
      ignoredProgrammaticScrollOffsetRef.current = actualScrollOffset;
      attempts += 1;
      if (actualScrollOffset === targetScrollOffset || attempts >= 180) {
        restoredConversationRef.current = conversationId;
        restorationPendingRef.current = false;
        restorationFrameRef.current = null;
        shouldFollowStreamingRef.current = isViewportNearBottom(viewport);
        setShowScrollToBottom(shouldShowScrollToBottom(viewport));
        return;
      }
      restorationFrameRef.current = requestAnimationFrame(restore);
    };

    restore();
    return () => {
      if (restorationFrameRef.current !== null) {
        cancelAnimationFrame(restorationFrameRef.current);
        restorationFrameRef.current = null;
      }
    };
  }, [
    activeOverlays.length,
    conversationId,
    detailQuery.data,
    messagesQuery.isPending,
  ]);

  /**
   * 仅在用户仍靠近底部时跟随流式内容，向上阅读后不抢夺滚动位置。
   */
  useLayoutEffect(() => {
    if (!streamingSignature) return;
    const viewport = viewportRef.current;
    if (viewport && shouldFollowStreamingRef.current) {
      viewport.scrollTop = viewport.scrollHeight;
      ignoredProgrammaticScrollOffsetRef.current = Math.max(
        0,
        Math.round(viewport.scrollTop),
      );
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
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      if (
        pendingScrollOffsetRef.current !== null &&
        !restorationPendingRef.current
      ) {
        persistScrollPosition(pendingScrollOffsetRef.current);
      }
      pendingScrollOffsetRef.current = null;
    };
  }, [conversationId, persistScrollPosition]);

  /**
   * 区分程序化滚动与用户滚动，并节流持久化当前对话的阅读位置。
   */
  function handleScroll() {
    const viewport = viewportRef.current;
    if (viewport) {
      shouldFollowStreamingRef.current = isViewportNearBottom(viewport);
      setShowScrollToBottom(shouldShowScrollToBottom(viewport));
    }
    const scrollOffset = Math.max(
      0,
      Math.round(viewportRef.current?.scrollTop ?? 0),
    );
    if (ignoredProgrammaticScrollOffsetRef.current === scrollOffset) {
      ignoredProgrammaticScrollOffsetRef.current = null;
      return;
    }
    ignoredProgrammaticScrollOffsetRef.current = null;
    if (restorationPendingRef.current) {
      restorationPendingRef.current = false;
      restoredConversationRef.current = conversationId;
      if (restorationFrameRef.current !== null) {
        cancelAnimationFrame(restorationFrameRef.current);
        restorationFrameRef.current = null;
      }
    }
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    pendingScrollOffsetRef.current = scrollOffset;
    scrollTimerRef.current = setTimeout(() => {
      pendingScrollOffsetRef.current = null;
      persistScrollPosition(scrollOffset);
    }, 250);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = content.trim();
    if (!message) return;
    const pending = pendingOperationRef.current;
    const operation =
      pending?.message === message
        ? pending.operation
        : createGenerationOperation();
    const selectedModes = pending?.message === message ? pending.modes : modes;
    pendingOperationRef.current = { message, operation, modes: selectedModes };
    sendMutation.mutate({ message, operation, modes: selectedModes });
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
        <span className="conversation-mode" title="当前使用的模型">
          <i aria-hidden="true" />
          <span>DeepSeek</span>
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
        {visibleMessages.length === 0 ? (
          <div className="message-empty">
            <h2>这是一段空白对话</h2>
            <p>输入内容后，回答会实时显示在这里。</p>
          </div>
        ) : (
          <div className="message-list">
            {visibleMessages.map((message) => (
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
                      {'generationId' in message &&
                      typeof message.generationId === 'string' ? (
                        <button
                          disabled={retryMutation.isPending}
                          onClick={() =>
                            retryMutation.mutate(message.generationId)
                          }
                          type="button"
                        >
                          重新生成
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
            {questionnaireGenerating ? (
              <div className="task-question-waiting" aria-live="polite">
                <ListChecks aria-hidden="true" size={18} />
                正在根据任务目标生成需要确认的问题…
              </div>
            ) : null}
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
      {taskSetup && !questionnaireGenerating ? (
        <TaskSetupPanel
          content={questionnaireMessage?.content ?? ''}
          conversationId={conversationId}
          generationId={
            questionnaireMessage && 'generationId' in questionnaireMessage
              ? questionnaireMessage.generationId
              : undefined
          }
        />
      ) : null}
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
            placeholder="输入消息…"
            ref={textareaRef}
            rows={1}
            value={content}
          />
          <GenerationModeToggles
            disabled={sendMutation.isPending}
            modes={modes}
            onChange={setModes}
          />
          <button
            aria-label="发送消息"
            disabled={sendMutation.isPending || !content.trim()}
            type="submit"
          >
            <ArrowUp aria-hidden="true" size={19} />
          </button>
          <p>
            <span>内容由 AI 生成，请核实重要信息</span>
            <span>Enter 发送 · Shift + Enter 换行</span>
          </p>
        </div>
      </form>
    </div>
  );
}
