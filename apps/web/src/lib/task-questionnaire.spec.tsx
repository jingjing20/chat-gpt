import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseTaskQuestionnaire,
  stripLegacyTaskQuestionnaireInstruction,
} from './task-questionnaire';

test('解析服务端生成的动态任务问卷', () => {
  const questionnaire = parseTaskQuestionnaire(
    '```json\n{"questions":[{"id":"cadence","question":"多久检查一次？","options":["每天","每周"]},{"id":"scope","question":"关注哪些变化？","options":["工作流","模型"]}],"task":{"title":"AI 变化监控","prompt":"监控重要变化","cadence":"DAILY"}}\n```',
  );
  assert.equal(questionnaire?.questions[1]?.question, '关注哪些变化？');
  assert.equal(questionnaire?.task.cadence, 'DAILY');
});

test('兼容隐藏旧版错误写入用户消息的内部提示词', () => {
  assert.equal(
    stripLegacyTaskQuestionnaireInstruction(
      '监控技术变化\n\n你正在为这个目标设计定时任务。内部约束',
    ),
    '监控技术变化',
  );
});
