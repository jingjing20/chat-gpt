import type { Metadata } from 'next';
import { QueryProvider } from '@/components/query-provider';
import { GenerationManagerHost } from '@/components/generation-manager-host';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lucidra',
  description: '支持多用户隔离的并发聊天应用。',
};

/**
 * 根布局承载用户级 GenerationManager，使实时连接独立于具体对话页面的挂载周期。
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <QueryProvider>
          <GenerationManagerHost />
          {children}
        </QueryProvider>
      </body>
    </html>
  );
}
