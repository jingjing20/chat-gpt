import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const generationCreateDuration = new Trend('generation_create_duration', true);

export const options = {
  scenarios: {
    hundred_users: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 100),
      duration: __ENV.DURATION || '5m',
    },
  },
  thresholds: {
    generation_create_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
  },
};

const baseUrl = __ENV.BASE_URL || 'http://localhost:3001';

export function setup() {
  if (!__ENV.ACCESS_COOKIE || !__ENV.CSRF_TOKEN || !__ENV.CONVERSATION_ID) {
    throw new Error(
      '必须提供 ACCESS_COOKIE、CSRF_TOKEN 和 CONVERSATION_ID；脚本不会记录这些值。',
    );
  }
}

export default function () {
  const response = http.post(
    `${baseUrl}/api/v1/conversations/${__ENV.CONVERSATION_ID}/generations`,
    JSON.stringify({ content: `性能基线请求 ${__VU}-${__ITER}` }),
    {
      headers: {
        'Content-Type': 'application/json',
        Cookie: __ENV.ACCESS_COOKIE,
        'X-CSRF-Token': __ENV.CSRF_TOKEN,
        'Idempotency-Key': `k6-${__VU}-${__ITER}`,
      },
    },
  );
  generationCreateDuration.add(response.timings.duration);
  check(response, {
    'generation 接口返回 202': (result) => result.status === 202,
  });
  sleep(1);
}
