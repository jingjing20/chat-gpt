import { ConversationView } from '@/components/conversation-view';

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ taskSetup?: string }>;
}) {
  const { conversationId } = await params;
  const { taskSetup } = await searchParams;
  return (
    <ConversationView
      conversationId={conversationId}
      key={conversationId}
      taskSetup={taskSetup}
    />
  );
}
