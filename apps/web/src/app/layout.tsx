import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Concurrent Chat',
  description: 'A resilient multi-conversation streaming AI chat application.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
