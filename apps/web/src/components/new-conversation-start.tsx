'use client';

import { createConversation, createGeneration } from '@/lib/chat-api';
import { useGenerationStore } from '@/lib/generation-store';
import { queryKeys } from '@/lib/query-keys';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ArrowUp } from 'lucide-react';

function createTitle(content: string) {
  const compact = content.replace(/\s+/g, ' ').trim();
  return compact.length > 32 ? `${compact.slice(0, 32)}…` : compact;
}

export function NewConversationStart() {
  const [content, setContent] = useState('');
  const queryClient = useQueryClient();
  const router = useRouter();
  const startMutation = useMutation({
    mutationFn: async (message: string) => {
      const conversation = await createConversation(createTitle(message));
      const result = await createGeneration(conversation.id, message);
      return { conversation, result };
    },
    onSuccess: ({ conversation, result }) => {
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
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.all,
      });
      router.push(`/chat/${conversation.id}`);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = content.trim();
    if (message) startMutation.mutate(message);
  }

  return (
    <div className="empty-chat">
      <div className="empty-chat-intro">
        <span className="empty-chat-orb" aria-hidden="true" />
        <h1>有什么可以帮你？</h1>
        <p>无论是梳理思路、分析问题，还是编写代码，都可以从这里开始。</p>
      </div>
      <form className="home-composer" onSubmit={submit}>
        <textarea
          aria-label="消息内容"
          autoFocus
          maxLength={20_000}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="输入消息…"
          rows={1}
          value={content}
        />
        <button
          aria-label="发送消息"
          disabled={startMutation.isPending || !content.trim()}
          type="submit"
        >
          <ArrowUp aria-hidden="true" size={19} />
        </button>
        {startMutation.isError ? (
          <p className="home-composer-error">创建对话失败，请稍后重试。</p>
        ) : null}
      </form>
    </div>
  );
}
