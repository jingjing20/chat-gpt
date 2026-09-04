'use client';

import {
  createConversationWithGeneration,
  createGenerationOperation,
  listScheduledTasks,
} from '@/lib/chat-api';
import { useGenerationStore } from '@/lib/generation-store';
import { queryKeys } from '@/lib/query-keys';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Check, ChevronDown, ListFilter, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { TaskActions } from './task-actions';

type TaskFilter = 'ACTIVE' | 'PAUSED' | 'COMPLETED';
const filters: Array<{ value: TaskFilter; label: string }> = [
  { value: 'ACTIVE', label: '活动' },
  { value: 'PAUSED', label: '已暂停' },
  { value: 'COMPLETED', label: '已完成' },
];
const recommendations = [
  {
    id: 'ai-brief',
    icon: '📰',
    title: 'AI 技术与市场简报',
    description: '每天整理值得关注的 AI 行业动态与产品更新',
    cadence: 'DAILY',
  },
  {
    id: 'engineering',
    icon: '💻',
    title: '全栈工程实践',
    description: '每周梳理前端、后端与数据平台的重要技术变化',
    cadence: 'WEEKLY',
  },
  {
    id: 'project-step',
    icon: '🤖',
    title: '项目推进提醒',
    description: '每周给出一个清晰、可执行的项目推进建议',
    cadence: 'WEEKLY',
  },
] as const;

function formatRun(value: string | null) {
  if (!value) return '未安排下次运行';
  return `下次运行 ${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))}`;
}

export function ScheduledTasks() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState<TaskFilter>('ACTIVE');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const tasksQuery = useQuery({
    queryKey: queryKeys.tasks.list(filter),
    queryFn: () => listScheduledTasks(filter),
  });
  const conversationMutation = useMutation({
    mutationFn: (input: { title: string; prompt: string; setupId: string }) =>
      createConversationWithGeneration(
        input.title,
        input.prompt,
        createGenerationOperation(),
        undefined,
        { taskQuestionnaire: true },
      ),
    onSuccess: (result, input) => {
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
      router.push(
        `/chat/${result.conversation.id}?taskSetup=${encodeURIComponent(input.setupId)}`,
      );
    },
  });

  function startSetup(title: string, prompt: string, setupId: string) {
    conversationMutation.mutate({
      title,
      setupId,
      prompt,
    });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt) return;
    startSetup(prompt.slice(0, 32), prompt, `custom:${prompt}`);
  }
  const activeFilter = filters.find((item) => item.value === filter)!;

  return (
    <main className="tasks-page">
      <section className="tasks-content">
        <header className="tasks-header">
          <div>
            <h1>定时任务</h1>
            <p>安排任务、设置提醒，或定期跟踪你关心的内容。</p>
          </div>
          <div className="task-filter">
            <button
              aria-expanded={isFilterOpen}
              className="tasks-activity-button"
              onClick={() => setIsFilterOpen((open) => !open)}
              type="button"
            >
              <ListFilter aria-hidden="true" size={17} />
              {activeFilter.label}
              <ChevronDown aria-hidden="true" size={15} />
            </button>
            {isFilterOpen ? (
              <div className="task-filter-menu" role="menu">
                {filters.map((item) => (
                  <button
                    className={item.value === filter ? 'active' : ''}
                    key={item.value}
                    onClick={() => {
                      setFilter(item.value);
                      setIsFilterOpen(false);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    {item.label}
                    {item.value === filter ? (
                      <Check aria-hidden="true" size={17} />
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </header>
        <form className="task-composer" onSubmit={submit}>
          <Plus aria-hidden="true" size={22} />
          <input
            aria-label="任务描述"
            maxLength={200}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="安排任务"
            value={draft}
          />
          <button
            aria-label="通过对话安排任务"
            disabled={conversationMutation.isPending || !draft.trim()}
            type="submit"
          >
            <ArrowUp aria-hidden="true" size={20} />
          </button>
        </form>
        <section className="task-list" aria-labelledby="tasks-title">
          <h2 id="tasks-title">{activeFilter.label}</h2>
          {tasksQuery.isPending ? (
            <p className="task-list-state">正在加载任务…</p>
          ) : null}
          {tasksQuery.isError ? (
            <p className="task-list-state">任务加载失败，请稍后重试。</p>
          ) : null}
          {tasksQuery.data?.items.length === 0 ? (
            <p className="task-list-state">这里还没有任务。</p>
          ) : null}
          {tasksQuery.data?.items.map((task) => (
            <article className="task-row" key={task.id}>
              <span className="task-row-icon" aria-hidden="true">
                ⏱️
              </span>
              <div>
                <h3>{task.title}</h3>
                <p>
                  {task.status === 'PAUSED'
                    ? `已暂停 · ${task.lastRunAt ? '上次运行已有记录' : '尚未运行'}`
                    : task.status === 'COMPLETED'
                      ? '已完成'
                      : formatRun(task.nextRunAt)}
                </p>
              </div>
              <TaskActions task={task} />
            </article>
          ))}
        </section>
        <section
          className="task-list recommendations"
          aria-labelledby="recommendations-title"
        >
          <h2 id="recommendations-title">推荐</h2>
          {recommendations.map((task) => (
            <button
              aria-label={`通过对话创建：${task.title}`}
              className="task-row task-recommendation-row"
              disabled={conversationMutation.isPending}
              key={task.id}
              onClick={() =>
                startSetup(
                  task.title,
                  task.description,
                  `${task.id}:${task.cadence}`,
                )
              }
              type="button"
            >
              <span className="task-row-icon" aria-hidden="true">
                {task.icon}
              </span>
              <span className="task-row-copy">
                <strong>{task.title}</strong>
                <small>{task.description}</small>
              </span>
              <Plus aria-hidden="true" size={21} />
            </button>
          ))}
        </section>
      </section>
    </main>
  );
}
