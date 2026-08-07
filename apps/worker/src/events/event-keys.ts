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
