'use client';

import { getGenerationEvents, syncGenerations } from '@/lib/chat-api';
import { useGenerationStore } from '@/lib/generation-store';
import { queryKeys } from '@/lib/query-keys';
import { SseParser } from '@/lib/sse-parser';
import { userEventSchema, type UserEvent } from '@chat/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * 在路由之上维护用户级 SSE，并把所有对话的 generation 事件归并到全局 store。
 */
export function GenerationManager({ userId }: { userId: string }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const controller = new AbortController();
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let initialized = false;

    /**
     * sequence 出现缺口时优先补拉事件，历史已裁剪时用完整快照收敛本地状态。
     */
    const resync = async (event: UserEvent) => {
      const current =
        useGenerationStore.getState().generations[event.generationId];
      const history = await getGenerationEvents(
        event.generationId,
        current?.lastAppliedSequence ?? 0,
      );
      if (history.mode === 'snapshot') {
        useGenerationStore.getState().replaceSnapshot(event.generationId, {
          content: history.snapshot.content,
          reasoningContent: history.snapshot.reasoningContent ?? '',
          lastAppliedSequence: history.snapshot.sequence,
          status: history.snapshot.status,
        });
      } else {
        for (const missed of history.events) {
          if (useGenerationStore.getState().apply(missed) === 'gap') {
            throw new Error('Generation 补偿事件仍存在缺口');
          }
        }
      }
      const repaired =
        useGenerationStore.getState().generations[event.generationId];
      if (
        !repaired ||
        repaired.syncState === 'resyncing' ||
        repaired.lastAppliedSequence < event.sequence
      ) {
        throw new Error('Generation 补偿未追平实时事件');
      }
    };

    /**
     * 首次连接先固定同步快照和用户流游标，之后按持久游标续接 SSE。
     */
    const connect = async (): Promise<void> => {
      useGenerationStore.getState().setConnectionStatus('connecting');
      const cursorKey = `chat.eventCursor.${userId}`;
      try {
        if (!initialized) {
          const sync = await syncGenerations();
          for (const generation of sync.activeGenerations) {
            useGenerationStore.getState().register({
              generationId: generation.generationId,
              conversationId: generation.conversationId,
              messageId: generation.messageId,
              status: generation.status,
              content: generation.content,
              reasoningContent: generation.reasoningContent ?? '',
              lastAppliedSequence: generation.sequence,
              syncState: 'synced',
            });
          }
          sessionStorage.setItem(cursorKey, sync.eventCursor);
          initialized = true;
        }
        const cursor = sessionStorage.getItem(cursorKey) ?? '0-0';
        const response = await fetch(
          `/api/v1/events?after=${encodeURIComponent(cursor)}`,
          {
            headers: { Accept: 'text/event-stream' },
            credentials: 'include',
            signal: controller.signal,
          },
        );
        if (!response.ok || !response.body) throw new Error('事件连接失败');
        useGenerationStore.getState().setConnectionStatus('connected');
        retry = 0;
        const parser = new SseParser();
        const decoder = new TextDecoder();
        const reader = response.body.getReader();
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          for (const frame of parser.push(
            decoder.decode(chunk, { stream: true }),
          )) {
            const event = userEventSchema.parse(JSON.parse(frame.data));
            const result = useGenerationStore.getState().apply(event);
            if (result === 'gap') await resync(event);
            if (frame.id) sessionStorage.setItem(cursorKey, frame.id);
            if (
              event.type === 'generation.completed' ||
              event.type === 'generation.failed' ||
              event.type === 'generation.cancelled'
            ) {
              await Promise.all([
                queryClient.invalidateQueries({
                  queryKey: queryKeys.conversations.messages(
                    event.conversationId,
                  ),
                }),
                queryClient.invalidateQueries({
                  queryKey: queryKeys.conversations.all,
                }),
              ]);
            }
          }
        }
        if (!controller.signal.aborted) throw new Error('事件连接已断开');
      } catch {
        if (controller.signal.aborted) return;
        useGenerationStore.getState().setConnectionStatus('disconnected');
        /**
         * 指数退避叠加抖动，避免服务恢复时多个标签同时发起重连。
         */
        const base = Math.min(15_000, 1_000 * 2 ** retry++);
        const delay = Math.round(base * (0.8 + Math.random() * 0.4));
        timer = setTimeout(() => void connect(), delay);
      }
    };
    void connect();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [queryClient, userId]);

  return null;
}
