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
