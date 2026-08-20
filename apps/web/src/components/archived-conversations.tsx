'use client';

import { AlertDialog } from '@base-ui/react/alert-dialog';
import type { ConversationResponse } from '@chat/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArchiveRestore, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  deleteConversation,
  listConversations,
  restoreConversation,
} from '@/lib/chat-api';
import { queryKeys } from '@/lib/query-keys';

export function ArchivedConversations() {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<ConversationResponse | null>(
    null,
  );
  const archivedQuery = useQuery({
    queryKey: queryKeys.conversations.list(true),
    queryFn: () => listConversations(true),
  });
  const restoreMutation = useMutation({
    mutationFn: restoreConversation,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.all,
      });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteConversation,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.all,
      });
      setDeleteTarget(null);
    },
  });

  return (
    <section className="settings-page">
      <header className="settings-header">
        <p>设置</p>
        <h1>已归档的对话</h1>
        <span>恢复需要继续使用的对话，或永久删除不再需要的数据。</span>
      </header>

      <div className="archived-list" aria-live="polite">
        {archivedQuery.isPending ? (
          <p className="settings-state">正在加载已归档对话…</p>
        ) : null}
        {archivedQuery.isError ? (
          <p className="settings-state error">加载失败，请稍后重试。</p>
        ) : null}
        {archivedQuery.data?.items.map((conversation) => (
          <article className="archived-item" key={conversation.id}>
            <div>
              <h2>{conversation.title}</h2>
              <time dateTime={conversation.archivedAt ?? undefined}>
                归档于 {formatDate(conversation.archivedAt)}
              </time>
            </div>
            <div className="archived-actions">
              <button
                className="secondary-button"
                disabled={restoreMutation.isPending || deleteMutation.isPending}
                onClick={() => restoreMutation.mutate(conversation.id)}
                type="button"
              >
                <ArchiveRestore aria-hidden="true" size={15} />
                恢复
              </button>
              <button
                className="danger-button"
                disabled={restoreMutation.isPending || deleteMutation.isPending}
                onClick={() => setDeleteTarget(conversation)}
                type="button"
              >
                <Trash2 aria-hidden="true" size={15} />
                永久删除
              </button>
            </div>
          </article>
        ))}
        {archivedQuery.isSuccess && archivedQuery.data.items.length === 0 ? (
          <div className="settings-empty">
            <ArchiveRestore aria-hidden="true" size={24} />
            <p>还没有已归档的对话。</p>
          </div>
        ) : null}
        {restoreMutation.isError ? (
          <p className="settings-state error">恢复失败，请稍后重试。</p>
        ) : null}
      </div>

      <AlertDialog.Root
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) setDeleteTarget(null);
        }}
        open={deleteTarget !== null}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="dialog-backdrop" />
          <AlertDialog.Viewport className="dialog-viewport">
            <AlertDialog.Popup className="dialog-popup">
              <AlertDialog.Title className="dialog-title">
                永久删除“{deleteTarget?.title}”？
              </AlertDialog.Title>
              <AlertDialog.Description className="dialog-description">
                该对话的消息、生成记录和用量数据将被永久删除，此操作无法撤销。
              </AlertDialog.Description>
              {deleteMutation.isError ? (
                <p className="dialog-error">
                  {deleteMutation.error.message || '删除失败，请稍后重试。'}
                </p>
              ) : null}
              <div className="dialog-actions">
                <AlertDialog.Close className="secondary-button" type="button">
                  取消
                </AlertDialog.Close>
                <button
                  className="danger-button"
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
                  }}
                  type="button"
                >
                  {deleteMutation.isPending ? '正在删除…' : '确认永久删除'}
                </button>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Viewport>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </section>
  );
}

function formatDate(value: string | null) {
  if (!value) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
