import type { GenerationStatus, UserEvent } from '@chat/contracts';
import { create } from 'zustand';

/**
 * 单个 generation 的浏览器实时投影，以 generationId 隔离并发对话的增量。
 */
export interface ActiveGenerationState {
  generationId: string;
  conversationId: string;
  messageId: string;
  status: GenerationStatus;
  content: string;
  reasoningContent: string;
  lastAppliedSequence: number;
  syncState: 'synced' | 'resyncing';
  error?: string;
  terminalAt?: number;
}

export type ApplyResult = 'applied' | 'duplicate' | 'gap';

export const ACTIVE_GENERATION_STATUSES: readonly GenerationStatus[] = [
  'QUEUED',
  'STARTING',
  'STREAMING',
  'CANCEL_REQUESTED',
];

export function isGenerationActive(status: GenerationStatus): boolean {
  return ACTIVE_GENERATION_STATUSES.includes(status);
}

/**
 * 按 generation 内单调 sequence 幂等归并事件；发现缺口时暂停追加并请求补偿。
 */
export function reduceGenerationEvent(
  current: ActiveGenerationState | undefined,
  event: UserEvent,
): { state: ActiveGenerationState; result: ApplyResult } {
  const base: ActiveGenerationState = current ?? {
    generationId: event.generationId,
    conversationId: event.conversationId,
    messageId: event.messageId,
    status: 'QUEUED',
    content: '',
    reasoningContent: '',
    lastAppliedSequence: 0,
    syncState: 'synced',
  };
  if (event.sequence <= base.lastAppliedSequence) {
    return { state: base, result: 'duplicate' };
  }
  if (event.sequence > base.lastAppliedSequence + 1) {
    return { state: { ...base, syncState: 'resyncing' }, result: 'gap' };
  }
  const next = { ...base, lastAppliedSequence: event.sequence };
  if (event.type === 'generation.started') next.status = 'STARTING';
  if (event.type === 'message.delta') {
    next.status = 'STREAMING';
    next.content += String(event.payload.delta ?? '');
  }
  if (event.type === 'message.reasoning_delta') {
    next.status = 'STREAMING';
    next.reasoningContent += String(event.payload.delta ?? '');
  }
  if (event.type === 'message.snapshot') {
    next.content = String(event.payload.content ?? '');
    next.reasoningContent = String(event.payload.reasoningContent ?? '');
    next.lastAppliedSequence = Number(
      event.payload.snapshotSequence ?? event.sequence,
    );
  }
  if (event.type === 'generation.completed') next.status = 'COMPLETED';
  if (event.type === 'generation.cancelled') next.status = 'CANCELLED';
  if (event.type === 'generation.failed') {
    next.status = 'FAILED';
    next.error = String(event.payload.safeMessage ?? '生成失败');
  }
  if (!isGenerationActive(next.status)) {
    next.terminalAt = Date.parse(event.occurredAt);
  }
  next.syncState = 'synced';
  return { state: next, result: 'applied' };
}

interface GenerationStore {
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  generations: Record<string, ActiveGenerationState>;
  drafts: Record<string, string>;
  register: (state: ActiveGenerationState) => void;
  apply: (event: UserEvent) => ApplyResult;
  replaceSnapshot: (
    generationId: string,
    snapshot: Pick<
      ActiveGenerationState,
      | 'content'
      | 'reasoningContent'
      | 'lastAppliedSequence'
      | 'status'
      | 'error'
    >,
  ) => void;
  setDraft: (conversationId: string, content: string) => void;
  clearDraft: (conversationId: string) => void;
  remove: (generationId: string) => void;
  clear: () => void;
  setConnectionStatus: (
    status: 'connecting' | 'connected' | 'disconnected',
  ) => void;
}

/**
 * 将用户级 generation 状态投影为当前对话所需的数据集合。
 */
export function selectConversationGenerations(conversationId: string) {
  return (store: GenerationStore) =>
    Object.values(store.generations).filter(
      (generation) => generation.conversationId === conversationId,
    );
}

/**
 * 为侧边栏提取对话活动状态，避免额外轮询每个对话。
 */
export function selectConversationActivity(conversationId: string) {
  return (store: GenerationStore) => {
    const generations = Object.values(store.generations).filter(
      (generation) => generation.conversationId === conversationId,
    );
    return {
      activeCount: generations.filter((generation) =>
        isGenerationActive(generation.status),
      ).length,
      latestStatus: generations.at(-1)?.status,
    };
  };
}

/**
 * 页面无关的 generation、连接状态和草稿仓库，路由切换不会清空其中的数据。
 */
export const useGenerationStore = create<GenerationStore>((set, get) => ({
  connectionStatus: 'connecting',
  generations: {},
  drafts: {},
  register: (state) =>
    set((store) => {
      const current = store.generations[state.generationId];
      return current && current.lastAppliedSequence >= state.lastAppliedSequence
        ? store
        : {
            generations: pruneGenerations({
              ...store.generations,
              [state.generationId]: state,
            }),
          };
    }),
  apply: (event) => {
    const reduced = reduceGenerationEvent(
      get().generations[event.generationId],
      event,
    );
    set((store) => ({
      generations: pruneGenerations({
        ...store.generations,
        [event.generationId]: reduced.state,
      }),
    }));
    return reduced.result;
  },
  replaceSnapshot: (generationId, snapshot) =>
    set((store) => {
      const current = store.generations[generationId];
      if (!current) return store;
      if (snapshot.lastAppliedSequence < current.lastAppliedSequence) {
        return store;
      }
      return {
        generations: pruneGenerations({
          ...store.generations,
          [generationId]: {
            ...current,
            ...snapshot,
            ...(!isGenerationActive(snapshot.status)
              ? { terminalAt: current.terminalAt ?? Date.now() }
              : { terminalAt: undefined }),
            syncState: 'synced',
          },
        }),
      };
    }),
  setDraft: (conversationId, content) =>
    set((store) => ({
      drafts: { ...store.drafts, [conversationId]: content },
    })),
  clearDraft: (conversationId) =>
    set((store) => {
      const drafts = { ...store.drafts };
      delete drafts[conversationId];
      return { drafts };
    }),
  remove: (generationId) =>
    set((store) => {
      const generations = { ...store.generations };
      delete generations[generationId];
      return { generations };
    }),
  clear: () =>
    set({ generations: {}, drafts: {}, connectionStatus: 'connecting' }),
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
}));

const TERMINAL_RETENTION_MS = 30 * 60 * 1000;
const TERMINAL_RETENTION_COUNT = 100;

/** 活动任务永久保留；终态任务按时间和数量双重限制浏览器内存。 */
function pruneGenerations(
  generations: Record<string, ActiveGenerationState>,
  now = Date.now(),
): Record<string, ActiveGenerationState> {
  const active = Object.values(generations).filter((generation) =>
    isGenerationActive(generation.status),
  );
  const terminal = Object.values(generations)
    .filter(
      (generation) =>
        !isGenerationActive(generation.status) &&
        (generation.terminalAt ?? now) >= now - TERMINAL_RETENTION_MS,
    )
    .sort((left, right) => (right.terminalAt ?? now) - (left.terminalAt ?? now))
    .slice(0, TERMINAL_RETENTION_COUNT);
  return Object.fromEntries(
    [...active, ...terminal].map((generation) => [
      generation.generationId,
      generation,
    ]),
  );
}
