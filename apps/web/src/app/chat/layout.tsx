import { ChatShell } from '@/components/chat-shell';
import type { ReactNode } from 'react';

export default function ChatLayout({ children }: { children: ReactNode }) {
  return <ChatShell>{children}</ChatShell>;
}
