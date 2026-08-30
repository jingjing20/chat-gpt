/** 将业务异常、Nest HTTP 异常和未知异常统一转换为安全 API 错误响应。 */

import type { ErrorResponse } from '@chat/contracts';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface KnownErrorBody {
  code?: string;
  message?: string | string[];
  details?: unknown;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  /** 保留已知业务错误码，同时隐藏未知异常细节并关联请求标识。 */
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const requestId = request.requestId ?? 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = '服务器内部错误';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      const known = typeof body === 'object' ? (body as KnownErrorBody) : {};
      code = known.code ?? this.defaultCode(status);
      message = Array.isArray(known.message)
        ? '请求参数不合法'
        : (known.message ?? exception.message);
      details =
        known.details ??
        (Array.isArray(known.message) ? known.message : undefined);
      if (status === HttpStatus.BAD_REQUEST) {
        status = HttpStatus.UNPROCESSABLE_ENTITY;
        code = 'VALIDATION_ERROR';
      }
    } else {
      this.logger.error(`未处理异常 requestId=${requestId}`, exception);
    }

    const body: ErrorResponse = {
      code,
      message,
      requestId,
      ...(details === undefined ? {} : { details }),
    };
    response.status(status).json(body);
  }

  private defaultCode(status: number): string {
    if (status === 401) return 'UNAUTHENTICATED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 404) return 'NOT_FOUND';
    if (status === 429) return 'RATE_LIMITED';
    return 'HTTP_ERROR';
  }
}
