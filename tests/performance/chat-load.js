import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const generationCreateDuration = new Trend('generation_create_duration', true);
const configuredUsers = Number(__ENV.VUS || 100);

export const options = {
  batch: 20,
  batchPerHost: 20,
  scenarios: {
    hundred_users: {
      executor: 'constant-vus',
      vus: configuredUsers,
      duration: __ENV.DURATION || '15m',
      gracefulStop: '30s',
    },
  },
  thresholds: {
    generation_create_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

const baseUrl = __ENV.BASE_URL || 'http://127.0.0.1:3001';

export function setup() {
  const runSuffix = Date.now().toString(16).slice(-6);
  if (__ENV.ACCESS_COOKIE && __ENV.CSRF_TOKEN && __ENV.CONVERSATION_ID) {
    return [
      {
        cookie: __ENV.ACCESS_COOKIE,
        csrfToken: __ENV.CSRF_TOKEN,
        conversationId: __ENV.CONVERSATION_ID,
        runSuffix,
      },
    ];
  }

  const identities = [];
  const runId = `${Date.now()}`;
  for (let index = 0; index < configuredUsers; index += 1) {
    const csrfResponse = http.get(`${baseUrl}/api/v1/auth/csrf`);
    const csrfToken = csrfResponse.json('csrfToken');
    const registration = http.post(
      `${baseUrl}/api/v1/auth/register`,
      JSON.stringify({
        email: `load-${runId}-${index}@example.invalid`,
        password: 'load-test-password-only',
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
      },
    );
    if (registration.status !== 201) {
      throw new Error(`负载用户注册失败，HTTP ${registration.status}`);
    }
    const accessToken = registration.cookies.chat_access?.[0]?.value;
    const issuedCsrfToken = registration.json('csrfToken');
    if (!accessToken || !issuedCsrfToken)
      throw new Error('注册响应缺少认证信息');
    identities.push({
      cookie: `chat_access=${accessToken}; chat_csrf=${issuedCsrfToken}`,
      csrfToken: issuedCsrfToken,
      runSuffix,
    });
    http.cookieJar().clear(baseUrl);
  }

  const conversations = http.batch(
    identities.map((identity, index) => [
      'POST',
      `${baseUrl}/api/v1/conversations`,
      JSON.stringify({ title: `负载测试 ${index + 1}` }),
      {
        headers: {
          'Content-Type': 'application/json',
          Cookie: identity.cookie,
          'X-CSRF-Token': identity.csrfToken,
        },
      },
    ]),
  );
  conversations.forEach((response, index) => {
    if (response.status !== 201) {
      throw new Error(`负载对话创建失败，HTTP ${response.status}`);
    }
    identities[index].conversationId = response.json('id');
  });
  return identities;
}

export default function (identities) {
  const identity = identities[(__VU - 1) % identities.length];
  const requestSuffix = (__VU * 100_000 + __ITER)
    .toString(16)
    .padStart(6, '0')
    .slice(-6);
  const suffix = `${identity.runSuffix}${requestSuffix}`;
  const response = http.post(
    `${baseUrl}/api/v1/conversations/${identity.conversationId}/generations`,
    JSON.stringify({
      content: `性能基线请求 ${__VU}-${__ITER}`,
      clientMessageId: `00000000-0000-4000-8000-${suffix}`,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        Cookie: identity.cookie,
        'X-CSRF-Token': identity.csrfToken,
        'Idempotency-Key': `k6-${identity.runSuffix}-${__VU}-${__ITER}`,
      },
    },
  );
  generationCreateDuration.add(response.timings.duration);
  check(response, {
    'generation 接口返回 202': (result) => result.status === 202,
  });
  sleep(Number(__ENV.ITERATION_PAUSE_SECONDS || 5));
}
