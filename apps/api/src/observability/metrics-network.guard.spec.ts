import { isInfrastructureAddress } from './metrics-network.guard';

describe('metrics 基础设施网络限制', () => {
  it.each([
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '10.20.30.40',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.10',
    'fd00::1',
  ])('允许本机和私有网络 %s', (address) => {
    expect(isInfrastructureAddress(address)).toBe(true);
  });

  it.each([undefined, '8.8.8.8', '172.32.0.1', '203.0.113.10', '2001:4860::1'])(
    '拒绝公网或未知地址 %s',
    (address) => {
      expect(isInfrastructureAddress(address)).toBe(false);
    },
  );
});
