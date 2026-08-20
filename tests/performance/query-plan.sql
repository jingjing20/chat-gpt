BEGIN;

INSERT INTO users (id, email, password_hash, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000000901',
  'query-plan@example.invalid',
  '仅用于查询计划测试',
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO conversations (id, owner_user_id, title, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000000902',
  '00000000-0000-4000-8000-000000000901',
  '查询计划测试',
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO messages (
  id,
  conversation_id,
  role,
  status,
  content,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  '00000000-0000-4000-8000-000000000902',
  'ASSISTANT'::"MessageRole",
  'COMPLETED'::"MessageStatus",
  '查询计划样本',
  now() - (sequence || ' milliseconds')::interval,
  now()
FROM generate_series(1, 1200) AS sequence;

INSERT INTO outbox_events (
  aggregate_type,
  aggregate_id,
  type,
  payload,
  created_at,
  published_at
)
SELECT
  'generation',
  gen_random_uuid(),
  'generation.enqueue',
  jsonb_build_object('generationId', gen_random_uuid()),
  now() - (sequence || ' milliseconds')::interval,
  CASE WHEN sequence <= 100 THEN NULL ELSE now() END
FROM generate_series(1, 5000) AS sequence;

ANALYZE messages;
ANALYZE outbox_events;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, role, status, content, created_at
FROM messages
WHERE conversation_id = '00000000-0000-4000-8000-000000000902'
  AND (created_at, id) < (now(), 'ffffffff-ffff-4fff-bfff-ffffffffffff')
ORDER BY created_at DESC, id DESC
LIMIT 51;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, aggregate_id, payload
FROM outbox_events
WHERE published_at IS NULL
  AND type = 'generation.enqueue'
ORDER BY created_at ASC
LIMIT 20;

ROLLBACK;
