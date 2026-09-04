export interface TaskQuestionnaire {
  questions: Array<{ id: string; question: string; options: string[] }>;
  task: { title: string; prompt: string; cadence: 'DAILY' | 'WEEKLY' };
}

const LEGACY_INSTRUCTION_MARKER = '\n\n你正在为这个目标设计定时任务。';

export function stripLegacyTaskQuestionnaireInstruction(content: string) {
  return content.split(LEGACY_INSTRUCTION_MARKER)[0] ?? content;
}

export function parseTaskQuestionnaire(
  content: string,
): TaskQuestionnaire | null {
  try {
    const normalized = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    const value = JSON.parse(normalized) as Partial<TaskQuestionnaire>;
    if (
      !Array.isArray(value.questions) ||
      value.questions.length < 2 ||
      value.questions.length > 5
    )
      return null;
    if (
      !value.task ||
      typeof value.task.title !== 'string' ||
      typeof value.task.prompt !== 'string' ||
      !['DAILY', 'WEEKLY'].includes(value.task.cadence ?? '')
    )
      return null;
    const questions = value.questions.map((question) => {
      if (
        !question ||
        typeof question.id !== 'string' ||
        typeof question.question !== 'string' ||
        !Array.isArray(question.options) ||
        question.options.length < 2 ||
        question.options.length > 5 ||
        question.options.some((option) => typeof option !== 'string')
      )
        throw new Error('INVALID_QUESTION');
      return {
        id: question.id,
        question: question.question,
        options: question.options,
      };
    });
    return { questions, task: value.task as TaskQuestionnaire['task'] };
  } catch {
    return null;
  }
}
