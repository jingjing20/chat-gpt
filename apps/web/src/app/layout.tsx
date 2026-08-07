import type { Metadata } from 'next';
import { QueryProvider } from '@/components/query-provider';
import { GenerationManagerHost } from '@/components/generation-manager-host';
import './globals.css';

export const metadata: Metadata = {
  title: 'Concurrent Chat',
  description: '支持多用户隔离的并发聊天应用。',
};

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
