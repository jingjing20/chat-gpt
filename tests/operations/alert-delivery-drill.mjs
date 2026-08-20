import { createServer } from 'node:http';

let received;
const server = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    received = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    response.writeHead(204).end();
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string')
  throw new Error('告警接收器启动失败');

const payload = {
  receiver: 'local-drill',
  status: 'firing',
  alerts: [
    {
      status: 'firing',
      labels: {
        alertname: 'ProviderCredentialOrBalanceFailure',
        severity: 'page',
      },
      annotations: { summary: '模型供应商出现认证或余额错误，单次即告警' },
      startsAt: new Date().toISOString(),
    },
  ],
};
const response = await fetch(`http://127.0.0.1:${address.port}/alerts`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
await new Promise((resolve) => setTimeout(resolve, 25));
server.close();

if (response.status !== 204 || received?.status !== 'firing') {
  throw new Error('本地告警触达演练失败');
}
if (
  received.alerts?.[0]?.labels?.alertname !==
  'ProviderCredentialOrBalanceFailure'
) {
  throw new Error('接收器未收到预期高优告警');
}
console.log('告警触达演练通过：本地接收器收到高优 firing 通知，HTTP 204。');
