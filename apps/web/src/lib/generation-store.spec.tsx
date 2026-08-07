import assert from 'node:assert/strict';
import test from 'node:test';
import type { UserEvent } from '@chat/contracts';
import { reduceGenerationEvent } from './generation-store';

function event(sequence: number, delta = '甲'): UserEvent {
  return {
    version: 1,
    eventId: '11111111-1111-4111-8111-111111111111',
    streamId: `${sequence}-0`,
    type: 'message.delta',
    conversationId: '22222222-2222-4222-8222-222222222222',
    generationId: '33333333-3333-4333-8333-333333333333',
    messageId: '44444444-4444-4444-8444-444444444444',
    sequence,
    occurredAt: '2026-08-07T00:00:00.000Z',
    payload: { delta },
  };
}

test('按 sequence 追加并忽略重复事件', () => {
  const first = reduceGenerationEvent(undefined, event(1));
  assert.equal(first.state.content, '甲');
  const duplicate = reduceGenerationEvent(first.state, event(1));
  assert.equal(duplicate.result, 'duplicate');
  assert.equal(duplicate.state.content, '甲');
});

test('发现顺序缺口后暂停追加', () => {
  const result = reduceGenerationEvent(undefined, event(2));
  assert.equal(result.result, 'gap');
  assert.equal(result.state.content, '');
  assert.equal(result.state.syncState, 'resyncing');
});
