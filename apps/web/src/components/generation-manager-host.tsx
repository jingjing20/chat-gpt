'use client';

import { getCurrentUser } from '@/lib/chat-api';
import { queryKeys } from '@/lib/query-keys';
import { useQuery } from '@tanstack/react-query';
import { GenerationManager } from './generation-manager';

export function GenerationManagerHost() {
  const userQuery = useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: getCurrentUser,
    retry: false,
  });

  return userQuery.isSuccess ? (
    <GenerationManager userId={userQuery.data.id} />
  ) : null;
}
