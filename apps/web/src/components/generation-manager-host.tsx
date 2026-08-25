'use client';

import { getCurrentUser } from '@/lib/chat-api';
import { queryKeys } from '@/lib/query-keys';
import { useQuery } from '@tanstack/react-query';
import { GenerationManager } from './generation-manager';

/**
 * 获取当前用户后挂载唯一的实时生成管理器；未登录或查询失败时不建立 SSE 连接。
 */
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
