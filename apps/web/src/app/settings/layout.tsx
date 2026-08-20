import { ChatShell } from '@/components/chat-shell';
import type { ReactNode } from 'react';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <ChatShell>{children}</ChatShell>;
}
