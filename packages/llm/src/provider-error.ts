import type { ProviderErrorCode } from './types';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryableBeforeFirstDelta: boolean;
  readonly httpStatus?: number;

  constructor(options: {
    code: ProviderErrorCode;
    safeMessage: string;
    retryableBeforeFirstDelta: boolean;
    httpStatus?: number;
    cause?: unknown;
  }) {
    super(options.safeMessage, { cause: options.cause });
    this.name = 'ProviderError';
    this.code = options.code;
    this.retryableBeforeFirstDelta = options.retryableBeforeFirstDelta;
    this.httpStatus = options.httpStatus;
  }
}

export function mapHttpError(status: number): ProviderError {
  if (status === 401)
    return error('AUTHENTICATION_FAILED', false, status, '模型供应商认证失败');
  if (status === 402)
    return error('INSUFFICIENT_BALANCE', false, status, '模型供应商余额不足');
  if (status === 400 || status === 422)
    return error('INVALID_REQUEST', false, status, '模型请求无效');
  if (status === 429)
    return error('RATE_LIMITED', true, status, '模型供应商请求过多');
  if (status === 500 || status === 503)
    return error('OVERLOADED', true, status, '模型供应商暂时不可用');
  return error('UNKNOWN', status >= 500, status, '模型供应商返回未知错误');
}

function error(
  code: ProviderErrorCode,
  retryableBeforeFirstDelta: boolean,
  httpStatus: number,
  safeMessage: string,
): ProviderError {
  return new ProviderError({
    code,
    retryableBeforeFirstDelta,
    httpStatus,
    safeMessage,
  });
}
