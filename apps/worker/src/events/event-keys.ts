/** 生成 Worker 写入的用户事件流、活动集合和快照 Redis 键。 */

export function eventKeys(
  prefix: string,
  userId: string,
  generationId: string,
) {
  const namespace = `${prefix}:{${userId}}`;
  return {
    sequence: `${namespace}:gen:${generationId}:seq`,
    state: `${namespace}:gen:${generationId}:state`,
    generationStream: `${namespace}:gen:${generationId}`,
    userStream: `${namespace}:user`,
  };
}
