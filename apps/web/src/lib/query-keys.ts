export const queryKeys = {
  currentUser: ['current-user'] as const,
  conversations: {
    all: ['conversations'] as const,
    list: (archived = false) =>
      ['conversations', 'list', { archived }] as const,
    detail: (conversationId: string) =>
      ['conversations', 'detail', conversationId] as const,
    messages: (conversationId: string) =>
      ['conversations', 'messages', conversationId] as const,
  },
};
