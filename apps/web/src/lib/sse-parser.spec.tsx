import assert from 'node:assert/strict';
import test from 'node:test';
import { SseParser } from './sse-parser';

test('解析跨 chunk SSE frame、注释和多行 data', () => {
  const parser = new SseParser();
  assert.deepEqual(parser.push('id: 1-0\nevent: message.del'), []);
  assert.deepEqual(
    parser.push('ta\ndata: {"a":\ndata: 1}\n\n: heartbeat\n\n'),
    [{ id: '1-0', event: 'message.delta', data: '{"a":\n1}' }],
  );
});
