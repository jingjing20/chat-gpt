import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = path.join(root, 'artifacts/multi-conversation-trace');
const runId = (
  await readFile(path.join(artifactRoot, 'LATEST'), 'utf8')
).trim();
const runDirectory = path.join(artifactRoot, runId);
const files = (await readdir(runDirectory))
  .filter((file) => file.endsWith('.json'))
  .sort();
const snapshots = await Promise.all(
  files.map(async (file) =>
    JSON.parse(await readFile(path.join(runDirectory, file), 'utf8')),
  ),
);

if (snapshots.length !== 7) {
  throw new Error(`预期 7 个阶段快照，实际得到 ${snapshots.length} 个`);
}

const final = snapshots.at(-1);
const [conversationA, conversationB] = final.identifiers.conversationIds;
const [generationA, generationB] = final.identifiers.generationIds;
const concurrent = snapshots[4];
const firstBIndex = concurrent.redis.userStream.findIndex(
  (entry) => entry.fields.event.generationId === generationB,
);
const example = {
  description: '两个对话并发流式输出的一次真实测试运行摘要',
  sourceRunId: runId,
  realComponents: [
    'Browser',
    'Web',
    'API',
    'PostgreSQL',
    'Outbox',
    'BullMQ',
    'Worker',
    'Redis',
    'SSE',
  ],
  fakeOnly: '外部 LLM 供应商响应',
  ids: {
    user: final.identifiers.userId,
    conversationA,
    conversationB,
    generationA,
    generationB,
  },
  timeline: snapshots.map((snapshot, index) => summarize(snapshot, index)),
  actualInterleaving: concurrent.redis.userStream
    .slice(Math.max(0, firstBIndex - 1), firstBIndex + 4)
    .map((entry) => ({
      userStreamId: entry.streamId,
      conversation:
        entry.fields.event.conversationId === conversationA ? 'A' : 'B',
      generation: entry.fields.event.generationId === generationA ? 'A' : 'B',
      type: entry.fields.event.type,
      sequence: entry.fields.event.sequence,
      occurredAt: entry.fields.event.occurredAt,
    })),
  finalCheck: {
    userStreamEventCount: final.redis.userStream.length,
    expectedEventCount: 302 + 302,
    postgresAndRedisContentLength: 38_592,
    newSseRequestsDuringConversationSwitching:
      final.browser.sseConnections.length -
      snapshots[1].browser.sseConnections.length,
  },
};

const output = path.join(
  root,
  'docs/examples/multi-conversation-trace.example.json',
);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(
  output,
  await prettier.format(JSON.stringify(example), { parser: 'json' }),
  'utf8',
);
console.log(`已导出简明真实样本：${path.relative(root, output)}`);

function summarize(snapshot, index) {
  return {
    step: `T${index}`,
    action: snapshot.stage,
    capturedAt: snapshot.capturedAt,
    browser: {
      currentConversation: snapshot.browser.visibleTitle,
      activeGenerationCount: snapshot.browser.activeGenerationDots,
      visibleAnswerLength:
        snapshot.browser.visibleAnswers.at(-1)?.textLength ?? 0,
      sseRequestCount: snapshot.browser.sseConnections.length,
    },
    postgres: {
      conversationCount: snapshot.postgres.conversations.length,
      messages: snapshot.postgres.messages.map((message) => ({
        id: message.id,
        conversation: aliasConversation(message.conversationId),
        role: message.role,
        status: message.status,
        contentLength: message.content.length,
      })),
      generations: snapshot.postgres.generations.map((generation) => ({
        id: generation.id,
        conversation: aliasConversation(generation.conversationId),
        status: generation.status,
        lastSequence: Number(generation.lastSequence),
        checkpointSequence: Number(generation.checkpointSequence),
        requestMessageId: generation.requestMessageId,
        responseMessageId: generation.responseMessageId,
      })),
      outbox: snapshot.postgres.outbox.map((event) => ({
        generation: aliasGeneration(event.aggregateId),
        type: event.type,
        published: event.publishedAt !== null,
        attempts: event.attempts,
      })),
    },
    redisAndQueue: {
      userStreamEventCount: snapshot.redis.userStream.length,
      generations: snapshot.redis.generations.map((generation) => ({
        generation: aliasGeneration(generation.generationId),
        sequence: generation.sequence,
        snapshotStatus: generation.state?.status ?? null,
        snapshotContentLength: generation.state?.content?.length ?? 0,
        generationStreamEventCount: generation.generationStream.length,
        bullMqJobState: generation.bullMq?.state ?? null,
      })),
    },
  };
}

function aliasConversation(id) {
  return id === conversationA ? 'A' : id === conversationB ? 'B' : id;
}

function aliasGeneration(id) {
  return id === generationA ? 'A' : id === generationB ? 'B' : id;
}
