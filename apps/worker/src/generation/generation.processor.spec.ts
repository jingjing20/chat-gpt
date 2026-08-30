/** 验证 generation 处理器的可重试错误分类规则。 */

import { GenerationProcessor } from './generation.processor';

describe('GenerationProcessor 数据库短暂故障恢复', () => {
  const processor = Object.create(
    GenerationProcessor.prototype,
  ) as GenerationProcessor;
  const retry = processor as unknown as {
    withDatabaseRetry<T>(operation: () => Promise<T>): Promise<T>;
  };

  it('连接关闭后按短退避重试并恢复', async () => {
    const operation = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('database connection closed'))
      .mockRejectedValueOnce(new Error('database connection timeout'))
      .mockResolvedValue('recovered');

    await expect(retry.withDatabaseRetry(operation)).resolves.toBe('recovered');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('非连接类错误不重复执行写入', async () => {
    const operation = jest
      .fn<Promise<never>, []>()
      .mockRejectedValue(new Error('validation failed'));

    await expect(retry.withDatabaseRetry(operation)).rejects.toThrow(
      'validation failed',
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
