import {
  authResponseSchema,
  conversationListResponseSchema,
  conversationResponseSchema,
  createMessageResponseSchema,
  createGenerationResponseSchema,
  generationEventHistorySchema,
  generationResponseSchema,
  generationSyncResponseSchema,
  messagePageResponseSchema,
  userResponseSchema,
  type ConversationResponse,
} from '@chat/contracts';
import { apiRequest, obtainCsrf } from './api';
import { useGenerationStore } from './generation-store';

export async function login(email: string, password: string) {
  await obtainCsrf();
  return authResponseSchema.parse(
    await apiRequest(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) },
      false,
    ),
  );
}

export async function register(email: string, password: string) {
  await obtainCsrf();
  return authResponseSchema.parse(
    await apiRequest(
      '/auth/register',
      { method: 'POST', body: JSON.stringify({ email, password }) },
      false,
    ),
  );
}

export async function logout(): Promise<void> {
  await apiRequest('/auth/logout', { method: 'POST' });
}

export async function getCurrentUser() {
  return userResponseSchema.parse(await apiRequest('/auth/me'));
}

export async function listConversations(
  archived = false,
  cursor?: string,
  limit = 50,
) {
  const search = new URLSearchParams({
    archived: String(archived),
    limit: String(limit),
  });
  if (cursor) search.set('cursor', cursor);
  return conversationListResponseSchema.parse(
    await apiRequest(`/conversations?${search}`),
  );
}

export async function createConversation(title = '新对话') {
  return conversationResponseSchema.parse(
    await apiRequest('/conversations', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  );
}

export async function getConversation(conversationId: string) {
  return conversationResponseSchema.parse(
    await apiRequest(`/conversations/${conversationId}`),
  );
}

export async function renameConversation(
  conversationId: string,
  title: string,
) {
  return conversationResponseSchema.parse(
    await apiRequest(`/conversations/${conversationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),
  );
}

export async function archiveConversation(conversationId: string) {
  return conversationResponseSchema.parse(
    await apiRequest(`/conversations/${conversationId}/archive`, {
      method: 'POST',
    }),
  );
}

export async function restoreConversation(conversationId: string) {
  return conversationResponseSchema.parse(
    await apiRequest(`/conversations/${conversationId}/restore`, {
      method: 'POST',
    }),
  );
}

export async function deleteConversation(conversationId: string) {
  await apiRequest(`/conversations/${conversationId}`, { method: 'DELETE' });
}

export async function markConversationRead(conversationId: string) {
  return conversationResponseSchema.parse(
    await apiRequest(`/conversations/${conversationId}/read`, {
      method: 'POST',
    }),
  );
}

export async function saveScrollPosition(
  conversationId: string,
  scrollOffset: number,
) {
  return conversationResponseSchema.parse(
    await apiRequest(`/conversations/${conversationId}/scroll-position`, {
      method: 'PUT',
      body: JSON.stringify({ scrollOffset }),
    }),
  );
}

export async function listMessages(conversationId: string, cursor?: string) {
  const search = new URLSearchParams({ limit: '30' });
  if (cursor) search.set('cursor', cursor);
  return messagePageResponseSchema.parse(
    await apiRequest(`/conversations/${conversationId}/messages?${search}`),
  );
}

export async function createMessage(conversationId: string, content: string) {
  return createMessageResponseSchema.parse(
    await apiRequest(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  );
}

export async function createGeneration(
  conversationId: string,
  content: string,
  operation: GenerationOperation = createGenerationOperation(),
  modes: GenerationModes = DEFAULT_GENERATION_MODES,
) {
  return createGenerationResponseSchema.parse(
    await apiRequest(`/conversations/${conversationId}/generations`, {
      method: 'POST',
      headers: { 'Idempotency-Key': operation.idempotencyKey },
      body: JSON.stringify({
        content,
        clientMessageId: operation.clientMessageId,
        ...modes,
      }),
    }),
  );
}

export interface GenerationOperation {
  idempotencyKey: string;
  clientMessageId: string;
}

export interface GenerationModes {
  reasoningEnabled: boolean;
}

export const DEFAULT_GENERATION_MODES: GenerationModes = {
  reasoningEnabled: false,
};

export function createGenerationOperation(): GenerationOperation {
  return {
    idempotencyKey: crypto.randomUUID(),
    clientMessageId: crypto.randomUUID(),
  };
}

export async function createConversationWithGeneration(
  title: string,
  content: string,
  operation: GenerationOperation,
  modes: GenerationModes = DEFAULT_GENERATION_MODES,
) {
  return createGenerationResponseSchema.parse(
    await apiRequest('/conversations/with-generation', {
      method: 'POST',
      headers: { 'Idempotency-Key': operation.idempotencyKey },
      body: JSON.stringify({
        title,
        content,
        clientMessageId: operation.clientMessageId,
        ...modes,
      }),
    }),
  );
}

export async function getGenerationEvents(
  generationId: string,
  afterSequence: number,
) {
  return generationEventHistorySchema.parse(
    await apiRequest(
      `/generations/${generationId}/events?after_sequence=${afterSequence}`,
    ),
  );
}

export async function cancelGeneration(
  conversationId: string,
  generationId: string,
) {
  const local = useGenerationStore.getState().generations[generationId];
  if (!local || local.conversationId !== conversationId) {
    throw new Error('停止目标与当前对话不匹配');
  }
  return generationResponseSchema.parse(
    await apiRequest(`/generations/${generationId}/cancel`, { method: 'POST' }),
  );
}

export async function retryGeneration(generationId: string) {
  return createGenerationResponseSchema.parse(
    await apiRequest(`/generations/${generationId}/retry`, {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    }),
  );
}

export async function syncGenerations(knownGenerationIds: string[] = []) {
  const search = new URLSearchParams();
  if (knownGenerationIds.length > 0) {
    search.set('known_generation_ids', knownGenerationIds.join(','));
  }
  const suffix = search.size > 0 ? `?${search}` : '';
  return generationSyncResponseSchema.parse(await apiRequest(`/sync${suffix}`));
}

export function conversationTimestamp(conversation: ConversationResponse) {
  return conversation.lastMessageAt ?? conversation.updatedAt;
}
