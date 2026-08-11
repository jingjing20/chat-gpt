import type { GenerationStatus, UserEvent } from '@chat/contracts';
import { create } from 'zustand';

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
      'content' | 'reasoningContent' | 'lastAppliedSequence' | 'status'
    >,
  ) => void;
  setDraft: (conversationId: string, content: string) => void;
  clearDraft: (conversationId: string) => void;
  clear: () => void;
  setConnectionStatus: (
    status: 'connecting' | 'connected' | 'disconnected',
  ) => void;
}

export function selectConversationGenerations(conversationId: string) {
  return (store: GenerationStore) =>
    Object.values(store.generations).filter(
      (generation) => generation.conversationId === conversationId,
    );
}

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
            generations: {
              ...store.generations,
              [state.generationId]: state,
            },
          };
    }),
  apply: (event) => {
    const reduced = reduceGenerationEvent(
      get().generations[event.generationId],
      event,
    );
    set((store) => ({
      generations: {
        ...store.generations,
        [event.generationId]: reduced.state,
      },
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
        generations: {
          ...store.generations,
          [generationId]: {
            ...current,
            ...snapshot,
            syncState: 'synced',
          },
        },
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
  clear: () =>
    set({ generations: {}, drafts: {}, connectionStatus: 'connecting' }),
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
}));
