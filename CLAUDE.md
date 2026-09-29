# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The canonical agent guide for this repo is `AGENTS.md` (layout, commands, migrations, env, architecture conventions, specs, CI, git workflow). It is imported below so there is a single source of truth — update `AGENTS.md`, not this file, when those facts change.

@AGENTS.md

## Claude-specific notes

- **Running a single test** (Jest, from the app directory or via `-w`):
  ```bash
  npm run test -w core_microservice -- src/modules/posts/path/to/file.spec.ts
  npm run test -w core_microservice -- -t "name of the test"
  npm run test -w client_app -- src/components/SomeComponent.spec.tsx
  ```
  Build `@repo/shared` and `@repo/contracts` first if their `dist/` is missing or stale.
- **Local infra**: `npm run docker:up` starts Postgres 15, Redis, RabbitMQ and MinIO from `docker-compose.yml`. Redis is used by `auth_microservice` (`src/config/redis.ts`); RabbitMQ is not wired into any service code yet — Auth → Core is HTTP, per `AGENTS.md`.
- **README is partly stale**: it lists a nonexistent `packages/types`, calls auth a NestJS service (it's Express), and documents `npm run db:migrate` (a no-op). Trust `AGENTS.md` and the code over the README.
- Root `package.json` lists Prisma dependencies, but no service uses Prisma — persistence is TypeORM throughout.
- `.opencode/commands/speckit.*` and `.opencode/agents/code-reviewer.md` are opencode-format; to follow the Spec Kit loop here, read those files and apply their steps manually against `specs/<active feature>/` (see `.specify/feature.json`).
