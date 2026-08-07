import {
  authResponseSchema,
  conversationListResponseSchema,
  conversationResponseSchema,
  createMessageResponseSchema,
  createGenerationResponseSchema,
  generationEventHistorySchema,
  generationSyncResponseSchema,
  messagePageResponseSchema,
  userResponseSchema,
  type ConversationResponse,
} from '@chat/contracts';
import { apiRequest, obtainCsrf } from './api';

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

export async function listConversations(archived = false) {
  return conversationListResponseSchema.parse(
    await apiRequest(`/conversations?archived=${archived}`),
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
) {
  return createGenerationResponseSchema.parse(
    await apiRequest(`/conversations/${conversationId}/generations`, {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        content,
        model: 'deepseek-v4-flash',
        clientMessageId: crypto.randomUUID(),
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

export async function syncGenerations() {
  return generationSyncResponseSchema.parse(await apiRequest('/sync'));
}

export function conversationTimestamp(conversation: ConversationResponse) {
  return conversation.lastMessageAt ?? conversation.updatedAt;
}
