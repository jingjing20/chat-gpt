# ADR-0001: OpenAI-compatible Chat Completions provider boundary

- Status: Accepted
- Date: 2026-08-04

## Context

The first provider will be DeepSeek, while the product must not couple its conversation and streaming system to one vendor. DeepSeek exposes an OpenAI-compatible Chat Completions API and data-only SSE stream.

## Decision

Use a normalized `LlmProviderAdapter` boundary based on the subset of Chat Completions required by the product. Provider request fields, response chunks, errors, usage, reasoning deltas, and finish reasons are normalized before entering the generation domain.

The worker is the only component allowed to call a provider. The browser and API application never call the provider directly.

## Consequences

- DeepSeek is the first adapter, not the domain model.
- Provider-only parameters stay inside the adapter.
- A future Responses API adapter can be introduced without rewriting conversations or browser events.
- Contract fixtures are required because “compatible” providers can still differ in optional fields and errors.
