/** 定义携带稳定业务错误码与可选详情的 API 异常。 */

import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus,
    public readonly details?: unknown,
  ) {
    super(
      { code, message, ...(details === undefined ? {} : { details }) },
      status,
    );
  }
}
