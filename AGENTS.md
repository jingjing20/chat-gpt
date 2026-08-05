# Repository guidance

## Scope

This repository implements the phased plan in `docs/project-development-plan.md`. Work on one phase at a time and do not pull later-phase product features into the current phase without an ADR and explicit approval.

## Architecture boundaries

- `apps/web` owns routing, rendering, browser state, and HTTP/SSE clients. It must never receive provider secrets.
- `apps/api` owns authentication, authorization, REST, sync, and the user event gateway. Long LLM requests do not run in request handlers.
- `apps/worker` is the only application allowed to start generation requests.
- `packages/contracts` contains transport schemas and shared DTOs. Do not import ORM types into it.
- `packages/config` validates process configuration. New environment variables require schema validation and `.env.example` documentation.
- Database changes belong in `packages/database` and require migrations.
- Provider-specific behavior belongs in `packages/llm`, behind a normalized adapter.

## Commands

Run commands from the repository root with pnpm:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Use `pnpm infra:up` and `pnpm infra:down` for local PostgreSQL and Redis.

## Verification

- Add or update tests for every behavior change, including failure and authorization paths.
- Run the narrowest relevant test while iterating, then all root verification commands before phase handoff.
- Never make live DeepSeek or OpenAI calls in automated tests. Use the fake provider.
- Do not mark a phase complete until every acceptance item in the project plan is demonstrated.

## Security and data handling

- Never commit `.env`, API keys, cookies, access tokens, refresh tokens, prompts, or generated user content.
- Logs use identifiers, lengths, timings, statuses, and safe error codes; they do not include message content by default.
- Every conversation, message, generation, event, and usage query must be scoped by the authenticated user.
- Treat Markdown and model output as untrusted input.

## Code conventions

- TypeScript strict mode stays enabled.
- Prefer explicit domain types and Zod schemas at transport and configuration boundaries.
- Keep state transitions and event reducers pure where possible.
- Use idempotent writes and conditional state transitions for asynchronous workflows.
- Use conventional commits when commits are requested; do not commit automatically.
