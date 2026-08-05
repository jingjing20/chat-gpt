# Local development runbook

## Start

```bash
cp .env.example .env
pnpm install
pnpm infra:up
pnpm dev
```

Docker Compose reads `.env` automatically. The default host ports are `15432`
and `16379` to avoid common local conflicts. If either is already in use,
select free values for `POSTGRES_HOST_PORT` and `REDIS_HOST_PORT`, then update
`DATABASE_URL` and `REDIS_URL` to use the same host ports.

## Verify infrastructure

```bash
docker compose -f infra/compose/compose.yml ps
docker compose -f infra/compose/compose.yml exec postgres pg_isready -U chat -d chat
docker compose -f infra/compose/compose.yml exec redis redis-cli ping
```

## Verify applications

```bash
curl http://localhost:3001/health/live
curl http://localhost:3001/health/ready
curl http://localhost:3002/health/live
curl http://localhost:3002/health/ready
```

`ready` currently validates application configuration. PostgreSQL and Redis dependency probes will be added when their clients are introduced.

## Stop

```bash
pnpm infra:down
```

Named Docker volumes intentionally preserve local data. Removing volumes is destructive and is not part of the normal stop command.
