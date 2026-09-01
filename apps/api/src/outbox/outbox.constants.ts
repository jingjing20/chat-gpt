/** 定义 generation 队列的注入令牌和稳定队列名称。 */

export const GENERATION_QUEUE = Symbol('GENERATION_QUEUE');
export const OUTBOX_EVENT_REDIS = Symbol('OUTBOX_EVENT_REDIS');
export const GENERATION_QUEUE_NAME = 'generation';
