import { HealthController } from './health.controller';

describe('HealthController', () => {
  const controller = new HealthController();

  it('reports the worker process as live', () => {
    expect(controller.live()).toMatchObject({
      status: 'ok',
      service: 'worker',
    });
  });

  it('reports validated configuration as ready', () => {
    expect(controller.ready()).toMatchObject({
      status: 'ok',
      service: 'worker',
      checks: { config: 'ok' },
    });
  });
});
