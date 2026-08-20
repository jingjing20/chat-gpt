import { readApiEnv } from '@chat/config';
import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import type { PrismaService } from '../database/prisma.service';
import { EventsService } from './events.service';

describe('EventsService SSE 背压', () => {
  const environment = readApiEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://chat:chat@localhost:15432/chat_test',
    REDIS_URL: 'redis://localhost:16379',
    ACCESS_TOKEN_SECRET: 'test-access-token-secret-at-least-32-characters',
    SSE_MAX_BUFFER_BYTES: '1024',
    SSE_DRAIN_TIMEOUT_MS: '100',
  });
  const service = new EventsService({} as PrismaService, environment);
  const write = service as unknown as {
    writeWithBackpressure(response: Response, chunk: string): Promise<void>;
  };

  afterAll(async () => {
    await service.onApplicationShutdown();
  });

  it('缓冲区超过上限时立即断开慢客户端', async () => {
    const responseWrite = jest.fn();
    const response = {
      writableLength: 1024,
      write: responseWrite,
    } as unknown as Response;

    await expect(
      write.writeWithBackpressure(response, 'data: x\n\n'),
    ).rejects.toMatchObject({ code: 'SSE_CLIENT_TOO_SLOW' });
    expect(responseWrite).not.toHaveBeenCalled();
  });

  it('socket 长时间无法 drain 时终止等待且清理监听器', async () => {
    const emitter = new EventEmitter();
    const response = Object.assign(emitter, {
      writableLength: 0,
      write: jest.fn().mockReturnValue(false),
    }) as unknown as Response;

    await expect(
      write.writeWithBackpressure(response, 'data: x\n\n'),
    ).rejects.toMatchObject({ code: 'SSE_CLIENT_TOO_SLOW' });
    expect(emitter.listenerCount('drain')).toBe(0);
    expect(emitter.listenerCount('close')).toBe(0);
  });
});
