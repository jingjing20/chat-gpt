import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TasksService } from './tasks.service';

@Injectable()
export class TasksSchedulerService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly tasks: TasksService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tasks.dispatchDue(), 30_000);
    this.timer.unref();
    void this.tasks.dispatchDue();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
