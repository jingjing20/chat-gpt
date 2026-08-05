import { HealthController } from './health.controller';

describe('HealthController', () => {
  const controller = new HealthController();

  it('reports the API process as live', () => {
    expect(controller.live()).toMatchObject({
      status: 'ok',
      service: 'api',
    });
  });

  it('reports validated configuration as ready', () => {
    expect(controller.ready()).toMatchObject({
      status: 'ok',
      service: 'api',
      checks: { config: 'ok' },
    });
  });
});
