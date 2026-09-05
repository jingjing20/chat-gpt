import {
  createScheduledTaskRequestSchema,
  scheduledTaskStatusSchema,
  updateScheduledTaskStatusRequestSchema,
  updateScheduledTaskRequestSchema,
  type CreateScheduledTaskRequest,
  type UpdateScheduledTaskRequest,
} from '@chat/contracts';
import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Delete,
  HttpCode,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ApiException } from '../http/api-exception';
import { ZodBodyPipe } from '../http/zod-body.pipe';
import { TasksService } from './tasks.service';

const idSchema = z.string().uuid();

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post()
  create(
    @Req() request: Request,
    @Body(new ZodBodyPipe(createScheduledTaskRequestSchema))
    body: CreateScheduledTaskRequest,
  ) {
    return this.tasks.create(request.auth!.userId, body);
  }

  @Get()
  list(@Req() request: Request, @Query('status') status?: string) {
    const parsed = status ? scheduledTaskStatusSchema.safeParse(status) : null;
    if (parsed && !parsed.success) this.validationError();
    return this.tasks.list(request.auth!.userId, parsed?.data);
  }

  @Patch(':taskId/status')
  updateStatus(
    @Req() request: Request,
    @Param('taskId') taskId: string,
    @Body(new ZodBodyPipe(updateScheduledTaskStatusRequestSchema))
    body: { status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' },
  ) {
    const parsedId = idSchema.safeParse(taskId);
    if (!parsedId.success) this.validationError();
    return this.tasks.updateStatus(
      request.auth!.userId,
      parsedId.data,
      body.status,
    );
  }

  @Patch(':taskId')
  update(
    @Req() request: Request,
    @Param('taskId') taskId: string,
    @Body(new ZodBodyPipe(updateScheduledTaskRequestSchema))
    body: UpdateScheduledTaskRequest,
  ) {
    return this.tasks.update(request.auth!.userId, this.id(taskId), body);
  }

  @Post(':taskId/run')
  runNow(@Req() request: Request, @Param('taskId') taskId: string) {
    return this.tasks.runNow(request.auth!.userId, this.id(taskId));
  }

  @Get(':taskId/runs')
  runs(@Req() request: Request, @Param('taskId') taskId: string) {
    return this.tasks.listRuns(request.auth!.userId, this.id(taskId));
  }

  @Delete(':taskId')
  @HttpCode(204)
  async delete(@Req() request: Request, @Param('taskId') taskId: string) {
    await this.tasks.delete(request.auth!.userId, this.id(taskId));
  }

  private id(value: string): string {
    const parsed = idSchema.safeParse(value);
    if (!parsed.success) this.validationError();
    return parsed.data;
  }

  private validationError(): never {
    throw new ApiException(
      'VALIDATION_ERROR',
      '请求参数不合法',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
