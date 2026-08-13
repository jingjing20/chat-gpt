import assert from 'node:assert/strict';
import test from 'node:test';
import type { UserEvent } from '@chat/contracts';
import {
  isGenerationActive,
  reduceGenerationEvent,
  selectConversationActivity,
} from './generation-store';
import { isViewportNearBottom } from './scroll-follow';

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

test('快照事件替换正文并推进到 snapshotSequence', () => {
  const initial = reduceGenerationEvent(undefined, event(1, '旧')).state;
  const snapshot: UserEvent = {
    ...event(2),
    type: 'message.snapshot',
    payload: {
      content: '完整正文',
      reasoningContent: '完整推理',
      snapshotSequence: 7,
    },
  };
  const result = reduceGenerationEvent(initial, snapshot);
  assert.equal(result.result, 'applied');
  assert.equal(result.state.content, '完整正文');
  assert.equal(result.state.reasoningContent, '完整推理');
  assert.equal(result.state.lastAppliedSequence, 7);
  assert.equal(result.state.syncState, 'synced');
});

test('缺口补偿完成前不会追加迟到事件', () => {
  const first = reduceGenerationEvent(undefined, event(1, '甲'));
  const gap = reduceGenerationEvent(first.state, event(3, '丙'));
  assert.equal(gap.state.content, '甲');
  const repaired = reduceGenerationEvent(gap.state, event(2, '乙'));
  const converged = reduceGenerationEvent(repaired.state, event(3, '丙'));
  assert.equal(converged.state.content, '甲乙丙');
  assert.equal(converged.state.syncState, 'synced');
});

test('对话活动 selector 只汇总目标对话的活动任务', () => {
  const active = reduceGenerationEvent(undefined, event(1)).state;
  const other = {
    ...active,
    generationId: '55555555-5555-4555-8555-555555555555',
    conversationId: '66666666-6666-4666-8666-666666666666',
    status: 'COMPLETED' as const,
  };
  const result = selectConversationActivity(active.conversationId)({
    generations: { [active.generationId]: active, [other.generationId]: other },
    drafts: {},
  } as Parameters<ReturnType<typeof selectConversationActivity>>[0]);
  assert.equal(result.activeCount, 1);
  assert.equal(isGenerationActive('CANCEL_REQUESTED'), true);
  assert.equal(isGenerationActive('COMPLETED'), false);
});

test('仅在视口贴近底部时保持自动滚动', () => {
  assert.equal(
    isViewportNearBottom({
      clientHeight: 600,
      scrollHeight: 1200,
      scrollTop: 600,
    }),
    true,
  );
  assert.equal(
    isViewportNearBottom({
      clientHeight: 600,
      scrollHeight: 1200,
      scrollTop: 551,
    }),
    false,
  );
});
