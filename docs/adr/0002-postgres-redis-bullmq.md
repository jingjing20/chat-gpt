# ADR-0002: PostgreSQL, Redis Streams, and BullMQ

- Status: Accepted
- Date: 2026-08-04

## Context

Generation tasks must outlive HTTP requests and browser routes. Final chat history needs durable relational storage, while active token events need low-latency publishing and a bounded replay window.

## Decision

- PostgreSQL is the system of record for users, conversations, messages, generations, attempts, usage, and outbox events.
- BullMQ provides generation scheduling, worker ownership, retries before the first delta, and concurrency control.
- Redis stores active snapshots and bounded user/generation event streams.
- Assistant content is checkpointed periodically and forced to PostgreSQL at every terminal transition.

## Consequences

- Tokens are not written to PostgreSQL one transaction at a time.
- Redis loss may fail an active generation, but cannot remove an already persisted final answer.
- The API uses a transactional outbox instead of an unsafe database/queue dual write.
