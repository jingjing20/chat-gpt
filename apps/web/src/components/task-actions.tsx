'use client';

import {
  deleteScheduledTask,
  listScheduledTaskRuns,
  runScheduledTask,
  updateScheduledTask,
  updateScheduledTaskStatus,
} from '@/lib/chat-api';
import { useGenerationStore } from '@/lib/generation-store';
import { queryKeys } from '@/lib/query-keys';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ScheduledTaskResponse } from '@chat/contracts';
import {
  MoreHorizontal,
  MessageSquareText,
  History,
  Pause,
  Pencil,
  Play,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export function TaskActions({ task }: { task: ScheduledTaskResponse }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [prompt, setPrompt] = useState(task.prompt);
  const [cadence, setCadence] = useState(task.cadence);
  const [timeOfDay, setTimeOfDay] = useState(task.timeOfDay);
  const runsQuery = useQuery({
    queryKey: queryKeys.tasks.runs(task.id),
    queryFn: () => listScheduledTaskRuns(task.id),
    enabled: historyOpen,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
  const runMutation = useMutation({
    mutationFn: () => runScheduledTask(task.id),
    onSuccess: (result) => {
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
      void refresh();
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.all,
      });
      setMenuOpen(false);
      router.push(`/chat/${result.conversation.id}`);
    },
  });
  const statusMutation = useMutation({
    mutationFn: () =>
      updateScheduledTaskStatus(
        task.id,
        task.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
      ),
    onSuccess: () => {
      void refresh();
      setMenuOpen(false);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteScheduledTask(task.id),
    onSuccess: () => {
      void refresh();
      setMenuOpen(false);
    },
  });
  const editMutation = useMutation({
    mutationFn: () =>
      updateScheduledTask(task.id, { title, prompt, cadence, timeOfDay }),
    onSuccess: () => {
      void refresh();
      setEditing(false);
      setMenuOpen(false);
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    editMutation.mutate();
  }
  return (
    <div className="task-actions">
      {task.executionConversationId ? (
        <button
          aria-label={`查看任务结果：${task.title}`}
          onClick={() => router.push(`/chat/${task.executionConversationId}`)}
          title="查看最近结果"
          type="button"
        >
          <MessageSquareText aria-hidden="true" size={18} />
        </button>
      ) : null}
      <button
        aria-label={`编辑任务：${task.title}`}
        onClick={() => setEditing(true)}
        type="button"
      >
        <Pencil aria-hidden="true" size={18} />
      </button>
      <button
        aria-expanded={menuOpen}
        aria-label={`更多操作：${task.title}`}
        onClick={() => setMenuOpen((open) => !open)}
        type="button"
      >
        <MoreHorizontal aria-hidden="true" size={20} />
      </button>
      {menuOpen ? (
        <div className="task-actions-menu">
          <button
            disabled={runMutation.isPending}
            onClick={() => runMutation.mutate()}
            type="button"
          >
            <RotateCw aria-hidden="true" size={17} />
            {runMutation.isPending ? '正在启动…' : '立即运行'}
          </button>
          {runMutation.isError ? (
            <p className="task-action-error" role="alert">
              启动失败，请稍后重试。
            </p>
          ) : null}
          {task.status !== 'COMPLETED' ? (
            <button
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate()}
              type="button"
            >
              {task.status === 'ACTIVE' ? (
                <Pause aria-hidden="true" size={17} />
              ) : (
                <Play aria-hidden="true" size={17} />
              )}
              {task.status === 'ACTIVE' ? '暂停' : '恢复'}
            </button>
          ) : null}
          <button
            onClick={() => {
              setHistoryOpen(true);
              setMenuOpen(false);
            }}
            type="button"
          >
            <History aria-hidden="true" size={17} />
            运行记录
          </button>
          <button
            className="danger"
            disabled={deleteMutation.isPending}
            onClick={() => {
              if (window.confirm(`确定删除“${task.title}”吗？`)) {
                deleteMutation.mutate();
              }
            }}
            type="button"
          >
            <Trash2 aria-hidden="true" size={17} />
            删除
          </button>
        </div>
      ) : null}
      {historyOpen ? (
        <div className="task-edit-backdrop" role="presentation">
          <section
            aria-label="定时任务运行记录"
            className="task-history-dialog"
          >
            <header>
              <div>
                <span>运行记录</span>
                <h2>{task.title}</h2>
              </div>
              <button
                aria-label="关闭运行记录"
                onClick={() => setHistoryOpen(false)}
                type="button"
              >
                <X aria-hidden="true" size={22} />
              </button>
            </header>
            <div className="task-history-list">
              {runsQuery.isPending ? <p>正在加载…</p> : null}
              {runsQuery.isError ? <p>运行记录加载失败。</p> : null}
              {runsQuery.data?.items.length === 0 ? (
                <p>暂无运行记录。</p>
              ) : null}
              {runsQuery.data?.items.map((run) => (
                <button
                  key={run.id}
                  onClick={() => router.push(`/chat/${run.conversationId}`)}
                  type="button"
                >
                  <span>
                    {run.trigger === 'MANUAL' ? '立即执行' : '定时触发'}
                  </span>
                  <strong>
                    {run.status === 'COMPLETED'
                      ? '已完成'
                      : run.status === 'FAILED'
                        ? '执行失败'
                        : run.status === 'CANCELLED'
                          ? '已取消'
                          : '执行中'}
                  </strong>
                  <time>{new Date(run.createdAt).toLocaleString('zh-CN')}</time>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
      {editing ? (
        <div className="task-edit-backdrop" role="presentation">
          <form
            aria-label="编辑定时任务"
            className="task-edit-dialog"
            onSubmit={submit}
          >
            <header>
              <div>
                <span>
                  {cadence === 'DAILY' ? '每天' : '每周'} {timeOfDay}
                </span>
                <h2>{task.title}</h2>
              </div>
              <button
                aria-label="关闭编辑弹窗"
                onClick={() => setEditing(false)}
                type="button"
              >
                <X aria-hidden="true" size={22} />
              </button>
            </header>
            <label>
              名称
              <input
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
                value={title}
              />
            </label>
            <label>
              提示词
              <textarea
                maxLength={20000}
                onChange={(event) => setPrompt(event.target.value)}
                rows={8}
                value={prompt}
              />
            </label>
            <div className="task-edit-schedule">
              <label>
                频率
                <select
                  onChange={(event) =>
                    setCadence(event.target.value as 'DAILY' | 'WEEKLY')
                  }
                  value={cadence}
                >
                  <option value="DAILY">每天</option>
                  <option value="WEEKLY">每周</option>
                </select>
              </label>
              <label>
                时间
                <input
                  onChange={(event) => setTimeOfDay(event.target.value)}
                  type="time"
                  value={timeOfDay}
                />
              </label>
            </div>
            <footer>
              <button onClick={() => setEditing(false)} type="button">
                取消
              </button>
              <button
                className="primary"
                disabled={
                  editMutation.isPending || !title.trim() || !prompt.trim()
                }
                type="submit"
              >
                {editMutation.isPending ? '保存中…' : '保存'}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </div>
  );
}
