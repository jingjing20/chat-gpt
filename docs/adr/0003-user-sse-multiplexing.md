# ADR-0003: User-level SSE multiplexing

- Status: Accepted
- Date: 2026-08-04

## Context

One user can run several generations across multiple conversations. Opening one browser connection per generation wastes connections and makes routing changes harder to reason about.

## Decision

Each browser tab maintains one authenticated user-level SSE-over-fetch connection. Events include conversation and generation identifiers. A root-level `GenerationManager` demultiplexes them into a normalized browser store.

REST remains the client-to-server command path. Changing the active conversation changes only the rendered projection and never cancels a generation.

## Consequences

- Background conversations update data without mounting Markdown DOM.
- Tabs receive independent copies of the same user stream; Redis consumer groups are not used for browser delivery.
- Event connection state and generation state remain separate state machines.
