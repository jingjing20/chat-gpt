import { Module } from '@nestjs/common';
import { GenerationsModule } from '../generations/generations.module';
import { TasksController } from './tasks.controller';
import { TasksSchedulerService } from './tasks-scheduler.service';
import { TasksService } from './tasks.service';

@Module({
  imports: [GenerationsModule],
  controllers: [TasksController],
  providers: [TasksService, TasksSchedulerService],
})
export class TasksModule {}
