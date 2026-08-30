/** 使用指定 Zod Schema 校验和规范化 HTTP 请求体。 */

import { ApiException } from './api-exception';
import { HttpStatus, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

@Injectable()
export class ZodBodyPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiException(
        'VALIDATION_ERROR',
        '请求参数不合法',
        HttpStatus.UNPROCESSABLE_ENTITY,
        result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
