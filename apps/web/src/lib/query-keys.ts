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
  tasks: {
    all: ['scheduled-tasks'] as const,
    list: (status?: string) => ['scheduled-tasks', 'list', { status }] as const,
    runs: (taskId: string) => ['scheduled-tasks', taskId, 'runs'] as const,
  },
};
