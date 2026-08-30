/** 生成用户事件流、活动任务集合及 generation 快照的 Redis 键。 */

export function eventKeys(
  prefix: string,
  userId: string,
  generationId?: string,
) {
  const namespace = `${prefix}:{${userId}}`;
  return {
    userStream: `${namespace}:user`,
    ...(generationId
      ? {
          sequence: `${namespace}:gen:${generationId}:seq`,
          state: `${namespace}:gen:${generationId}:state`,
          generationStream: `${namespace}:gen:${generationId}`,
        }
      : {}),
  };
}
