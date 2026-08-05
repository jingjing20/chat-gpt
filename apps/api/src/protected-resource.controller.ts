import type { ProtectedResourceResponse } from '@chat/contracts';
import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from './http/api-exception';

@Controller('protected-resources')
export class ProtectedResourceController {
  @Get(':ownerId')
  read(
    @Param('ownerId', new ParseUUIDPipe({ version: '4' })) ownerId: string,
    @Req() request: Request,
  ): ProtectedResourceResponse {
    if (request.auth!.userId !== ownerId) {
      throw new ApiException('NOT_FOUND', '资源不存在', HttpStatus.NOT_FOUND);
    }
    return { ownerId, value: '用户隔离验证资源' };
  }
}
