# @repo/shared

Backend-only infrastructure shared by the NestJS and Express services: TypeORM base classes and repository adapters, `DomainError` subclasses, the database error guard, the Winston logger, the `DomainExceptionFilter`, the observability helpers (request ids, metrics registry, internal-token check), the Redis client helpers, the shared access-token verifier, DTOs and event contracts.

## What goes where

Follow the rule in [AGENTS.md](../../AGENTS.md):

| Kind of code                                                                | Goes in                                            |
| --------------------------------------------------------------------------- | -------------------------------------------------- |
| Wire-format request and response interfaces (the frontend imports them)     | `@repo/contracts` (`packages/contracts`)           |
| Backend-only infrastructure: base classes, filters, logger, errors, metrics | `@repo/shared` (here)                              |
| `class-validator` DTOs used by controllers                                  | `@repo/shared/dtos` (`src/dtos`)                   |
| Domain entities and ports                                                   | The owning app module's `domain/` folder, not here |

Domain code throws `DomainError` subclasses from here; it never throws `HttpException`. The global filter maps them to HTTP responses.

## Import boundary

- Only the backend apps import `@repo/shared`: `core_microservice`, `auth_microservice` and `notifications_consumer_microservice`.
- `apps/client_app` never imports it. The client imports only `@repo/contracts`, which has no dependencies and is safe for the browser.

## Build before use

The package's `main` and `types` point at `dist/`, so the apps consume the compiled output:

```bash
npm run build -w @repo/shared            # tsc -p tsconfig.build.json -> dist/
npm run build -w @repo/shared -w @repo/contracts   # both, in dependency order
```

Turborepo runs this build automatically for `build`, `test` and `dev`. When you run one app on its own, or after you change this package, rebuild it first. A stale `dist/` shows up as confusing type errors. Rebuilding also deletes `dist/` under any running dev watcher, so restart the services that use it.

## Checks

```bash
npm run type-check -w @repo/shared   # tsc --noEmit
npm run test:cov -w @repo/shared     # unit specs, 70 lines / 60 branches
```
