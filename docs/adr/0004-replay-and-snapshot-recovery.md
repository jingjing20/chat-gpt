# ADR-0004: Bounded exact replay with snapshot fallback

- Status: Accepted
- Date: 2026-08-04

## Context

Refreshes, network interruptions, and event gaps must not duplicate or corrupt generated text. Keeping every token event forever is unnecessarily expensive.

## Decision

Every generation event receives a monotonic sequence. Redis keeps a user stream for live multiplexing and a generation stream for direct `after_sequence` recovery. Active and recent events are replayable for a configurable window, initially 24 hours.

When an event cursor is outside the replay window, the server returns a complete content snapshot with replace semantics. PostgreSQL stores periodic checkpoints and every final state.

## Consequences

- Clients apply events idempotently and stop on a sequence gap.
- Exact delta replay is bounded; correct current content is durable beyond that window.
- A lost upstream provider stream cannot resume at a provider token. After the first delta, failure preserves partial content and requires explicit user retry.
