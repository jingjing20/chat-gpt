'use client';

import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Dialog } from '@base-ui/react/dialog';
import { Menu } from '@base-ui/react/menu';
import type { ConversationResponse } from '@chat/contracts';
import { Archive, MoreHorizontal, Pencil } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { archiveConversation, renameConversation } from '@/lib/chat-api';
import { queryKeys } from '@/lib/query-keys';

export function ConversationActions({
  conversation,
  isActive,
}: {
  conversation: ConversationResponse;
  isActive: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [renameOpen, setRenameOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const renameMutation = useMutation({
    mutationFn: (nextTitle: string) =>
      renameConversation(conversation.id, nextTitle),
    onSuccess: async (updatedConversation) => {
      queryClient.setQueryData(
        queryKeys.conversations.detail(conversation.id),
        updatedConversation,
      );
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.all,
      });
      setRenameOpen(false);
    },
  });
  const archiveMutation = useMutation({
    mutationFn: () => archiveConversation(conversation.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.all,
      });
      setArchiveOpen(false);
      if (isActive) router.replace('/chat');
    },
  });

  function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (nextTitle) renameMutation.mutate(nextTitle);
  }

  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          aria-label={`操作对话：${conversation.title}`}
          className="conversation-menu-trigger"
        >
          <MoreHorizontal aria-hidden="true" size={17} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner
            align="end"
            className="menu-positioner"
            sideOffset={6}
          >
            <Menu.Popup className="conversation-menu">
              <Menu.Item
                className="conversation-menu-item"
                onClick={() => {
                  setTitle(conversation.title);
                  setRenameOpen(true);
                }}
              >
                <Pencil aria-hidden="true" size={14} />
                重命名
              </Menu.Item>
              <Menu.Item
                className="conversation-menu-item danger"
                onClick={() => setArchiveOpen(true)}
              >
                <Archive aria-hidden="true" size={14} />
                归档
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <Dialog.Root onOpenChange={setRenameOpen} open={renameOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="dialog-backdrop" />
          <Dialog.Viewport className="dialog-viewport">
            <Dialog.Popup className="dialog-popup">
              <Dialog.Title className="dialog-title">重命名对话</Dialog.Title>
              <Dialog.Description className="dialog-description">
                输入一个便于识别的新名称。
              </Dialog.Description>
              <form className="dialog-form" onSubmit={submitRename}>
                <input
                  aria-label="对话名称"
                  autoFocus
                  maxLength={100}
                  onChange={(event) => setTitle(event.target.value)}
                  value={title}
                />
                {renameMutation.isError ? (
                  <p className="dialog-error">重命名失败，请稍后重试。</p>
                ) : null}
                <div className="dialog-actions">
                  <Dialog.Close className="secondary-button" type="button">
                    取消
                  </Dialog.Close>
                  <button
                    className="primary-button compact"
                    disabled={renameMutation.isPending || !title.trim()}
                    type="submit"
                  >
                    保存
                  </button>
                </div>
              </form>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>

      <AlertDialog.Root onOpenChange={setArchiveOpen} open={archiveOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="dialog-backdrop" />
          <AlertDialog.Viewport className="dialog-viewport">
            <AlertDialog.Popup className="dialog-popup">
              <AlertDialog.Title className="dialog-title">
                归档“{conversation.title}”？
              </AlertDialog.Title>
              <AlertDialog.Description className="dialog-description">
                归档后，这段对话将从最近对话列表中移除。
              </AlertDialog.Description>
              {archiveMutation.isError ? (
                <p className="dialog-error">归档失败，请稍后重试。</p>
              ) : null}
              <div className="dialog-actions">
                <AlertDialog.Close className="secondary-button" type="button">
                  取消
                </AlertDialog.Close>
                <button
                  className="danger-button"
                  disabled={archiveMutation.isPending}
                  onClick={() => archiveMutation.mutate()}
                  type="button"
                >
                  确认归档
                </button>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Viewport>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
