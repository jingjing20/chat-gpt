'use client';

import { createScheduledTask } from '@/lib/chat-api';
import { queryKeys } from '@/lib/query-keys';
import { parseTaskQuestionnaire } from '@/lib/task-questionnaire';
import { useGenerationStore } from '@/lib/generation-store';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

export function TaskSetupPanel({
  conversationId,
  content,
  generationId,
}: {
  conversationId: string;
  content: string;
  generationId?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const questionnaire = useMemo(
    () => parseTaskQuestionnaire(content),
    [content],
  );
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!questionnaire) throw new Error('INVALID_QUESTIONNAIRE');
      const cadenceAnswer = answers.cadence ?? '';
      const cadence = /每天|daily|once a day/i.test(cadenceAnswer)
        ? 'DAILY'
        : questionnaire.task.cadence;
      return createScheduledTask({
        conversationId,
        title: questionnaire.task.title,
        prompt: `${questionnaire.task.prompt}\n\n用户偏好：\n${questionnaire.questions.map((question) => `${question.question}：${answers[question.id]}`).join('\n')}`,
        cadence,
        timeOfDay: '09:00',
        timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
        answers: questionnaire.questions.map((question) => ({
          question: question.question,
          answer: answers[question.id] ?? '',
        })),
      });
    },
    onSuccess: async () => {
      if (generationId) useGenerationStore.getState().remove(generationId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.conversations.messages(conversationId),
        }),
      ]);
      router.replace(`/chat/${conversationId}`);
    },
  });
  function close() {
    router.replace(`/chat/${conversationId}`);
  }

  if (!questionnaire) {
    return (
      <aside className="task-question-waiting error">
        <span>未能生成有效的问题卡片，请关闭后重试。</span>
        <button onClick={close} type="button">
          关闭
        </button>
      </aside>
    );
  }
  const question = questionnaire.questions[step]!;
  const selected = answers[question.id];
  const isLast = step === questionnaire.questions.length - 1;
  return (
    <aside className="task-setup-panel" aria-label="配置定时任务">
      <div className="task-setup-heading">
        <strong>{question.question}</strong>
        <span>
          {step + 1} / {questionnaire.questions.length}
        </span>
        <button aria-label="关闭任务配置" onClick={close} type="button">
          <X aria-hidden="true" size={18} />
        </button>
      </div>
      <div className="task-setup-options">
        {question.options.map((option, index) => (
          <button
            className={selected === option ? 'selected' : ''}
            key={option}
            onClick={() =>
              setAnswers((current) => ({ ...current, [question.id]: option }))
            }
            type="button"
          >
            <span>{index + 1}</span>
            {option}
            {selected === option ? (
              <Check aria-hidden="true" size={17} />
            ) : null}
          </button>
        ))}
      </div>
      <div className="task-setup-footer">
        <button
          disabled={step === 0}
          onClick={() => setStep((value) => value - 1)}
          type="button"
        >
          <ChevronLeft aria-hidden="true" size={17} />
          上一步
        </button>
        {!isLast ? (
          <button
            disabled={!selected}
            onClick={() => setStep((value) => value + 1)}
            type="button"
          >
            下一步
            <ChevronRight aria-hidden="true" size={17} />
          </button>
        ) : (
          <button
            disabled={!selected || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            type="button"
          >
            {createMutation.isPending ? '正在创建…' : '确认并创建'}
          </button>
        )}
      </div>
      {createMutation.isError ? (
        <p className="dialog-error">创建失败，请稍后重试。</p>
      ) : null}
    </aside>
  );
}
