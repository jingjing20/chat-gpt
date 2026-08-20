const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3001';
const connectionCount = Number(process.env.CONNECTIONS ?? 100);
const durationMs = Number(process.env.DURATION_MS ?? 1_800_000);
const sampleIntervalMs = Number(process.env.SAMPLE_INTERVAL_MS ?? 60_000);
const runId = Date.now();

const identities = [];
for (let offset = 0; offset < connectionCount; offset += 10) {
  const batch = Array.from(
    { length: Math.min(10, connectionCount - offset) },
    (_, index) => register(offset + index),
  );
  identities.push(...(await Promise.all(batch)));
}

const controllers = identities.map(() => new AbortController());
let receivedBytes = 0;
let streamErrors = 0;
const streams = identities.map(async (identity, index) => {
  const response = await fetch(`${baseUrl}/api/v1/events?after=0-0`, {
    headers: { Accept: 'text/event-stream', Cookie: identity.cookie },
    signal: controllers[index].signal,
  });
  if (response.status !== 200 || !response.body) {
    throw new Error(`SSE 建连失败，HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      receivedBytes += result.value.byteLength;
    }
  } catch (error) {
    if (!controllers[index].signal.aborted) {
      streamErrors += 1;
      throw error;
    }
  }
});

await waitForMetric('chat_sse_connections', connectionCount, 30_000);
const startedAt = Date.now();
const samples = [];
while (Date.now() - startedAt < durationMs) {
  samples.push(await sampleMetrics());
  await delay(
    Math.min(sampleIntervalMs, durationMs - (Date.now() - startedAt)),
  );
}
samples.push(await sampleMetrics());
controllers.forEach((controller) => controller.abort());
await Promise.allSettled(streams);

const rssValues = samples.map((sample) => sample.rss);
const firstRss = rssValues[0];
const lastRss = rssValues.at(-1);
const growthBytes = lastRss - firstRss;
const growthLimit = Math.max(firstRss * 0.25, 64 * 1024 * 1024);
if (streamErrors > 0) throw new Error(`SSE 流异常数为 ${streamErrors}`);
if (growthBytes > growthLimit) {
  throw new Error(`RSS 持续增长超过限制：${growthBytes} bytes`);
}
console.log(
  JSON.stringify({
    connections: connectionCount,
    durationMs,
    samples: samples.length,
    firstRss,
    lastRss,
    peakRss: Math.max(...rssValues),
    growthBytes,
    receivedBytes,
    streamErrors,
  }),
);

async function register(index) {
  const csrfResponse = await fetch(`${baseUrl}/api/v1/auth/csrf`);
  const { csrfToken } = await csrfResponse.json();
  const initialCsrf = cookieValue(csrfResponse, 'chat_csrf');
  const registration = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `chat_csrf=${initialCsrf}`,
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({
      email: `sse-${runId}-${index}@example.invalid`,
      password: 'sse-endurance-password-only',
    }),
  });
  if (registration.status !== 201) {
    throw new Error(`SSE 用户注册失败，HTTP ${registration.status}`);
  }
  const body = await registration.json();
  return {
    cookie: `chat_access=${cookieValue(registration, 'chat_access')}; chat_csrf=${body.csrfToken}`,
  };
}

function cookieValue(response, name) {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`));
  const value = cookie?.slice(name.length + 1).split(';')[0];
  if (!value) throw new Error(`响应缺少 Cookie：${name}`);
  return value;
}

async function waitForMetric(name, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sample = await sampleMetrics();
    if (sample.connections === expected) return;
    await delay(100);
  }
  throw new Error(`${name} 未在限定时间达到 ${expected}`);
}

async function sampleMetrics() {
  const response = await fetch(`${baseUrl}/metrics`);
  if (!response.ok) throw new Error(`metrics HTTP ${response.status}`);
  const text = await response.text();
  return {
    timestamp: Date.now(),
    rss: metric(text, 'process_resident_memory_bytes{service="api"}'),
    connections: metric(text, 'chat_sse_connections{service="api"}'),
  };
}

function metric(text, prefix) {
  const line = text
    .split('\n')
    .find((candidate) => candidate.startsWith(prefix));
  const value = Number(line?.slice(prefix.length).trim());
  if (!Number.isFinite(value)) throw new Error(`缺少指标：${prefix}`);
  return value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
