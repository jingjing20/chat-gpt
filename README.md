# Concurrent Chat

A production-oriented, multi-conversation streaming AI chat application. The repository follows the project plan in `docs/` and is implemented in independently verifiable phases.

## Repository layout

```text
apps/web       Next.js web application
apps/api       NestJS REST and event gateway
apps/worker    NestJS generation worker process
packages/*     Shared contracts, configuration, and future domain packages
infra/         Local and production infrastructure definitions
docs/          Architecture decisions and runbooks
```

## Prerequisites

- Node.js 22+
- pnpm 9.15.x
- Docker with Compose v2

## First-time setup

```bash
cp .env.example .env
pnpm install
pnpm infra:up
pnpm dev
```

The services use these default local endpoints:

- Web: `http://localhost:3000`
- API health: `http://localhost:3001/health/live`
- Worker health: `http://localhost:3002/health/live`
- PostgreSQL: `localhost:15432`
- Redis: `localhost:16379`

The non-standard host ports avoid clashing with existing local databases. If
either is occupied, change `POSTGRES_HOST_PORT` or `REDIS_HOST_PORT` in `.env`
and update the matching URL in the same file.

No LLM API key is required until phase 3. Automated tests use a fake provider rather than a paid external API.

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Security

Do not commit `.env`, provider keys, cookies, tokens, prompts, or generated user content. Use `.env.example` only as a schema and documentation source.
