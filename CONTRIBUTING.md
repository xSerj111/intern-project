# Contributing

Read [`README.md`](README.md) for setup, [`AGENTS.md`](AGENTS.md) for the package boundaries and [`DDD_ARCHITECTURE_GUIDE.md`](DDD_ARCHITECTURE_GUIDE.md) before touching a backend.

## Branches

Branch from `main` (or the current integration branch) and name the branch after the work:

- `feature/INO-<n>` or `feature/INO-<n>.<m>` for a ticketed feature (e.g. `feature/INO-6`)
- `feature/<short-name>` for work without a ticket (e.g. `feature/ui-redesign`)
- `fix/<short-name>` for bug fixes (e.g. `fix/redis_fix`)

## Commits

Conventional-style subject, with the ticket as the scope when there is one:

```
feat(INO-12): B6 API documentation (Swagger)
feat(client): warn that deleting a comment also deletes its replies
fix(db): store audit timestamps as timestamptz in every service
```

Types in use: `feat`, `fix`, `refactor`, `docs`, `chore`. Keep one logical change per commit. Do not add `Co-Authored-By` or tool attribution lines.

## Local gates

Run these before opening a PR. CI runs the first four (`.github/workflows/ci.yml`).

```bash
npm run lint:check                      # read-only; never run `npm run lint` unless you want files rewritten
npm run build                           # builds @repo/contracts and @repo/shared first, then the apps
npm run type-check
npm run test:cov -w core_microservice   # also: auth_microservice, notifications_consumer_microservice, @repo/shared (70% lines / 60% branches)
npm run test:e2e -w core_microservice   # API e2e; needs the infrastructure up (npm run docker:up)
npm run test:e2e -w notifications_consumer_microservice
npm run e2e                             # Playwright; stack and client must already be running
```

To run one spec: `cd apps/core_microservice && npx jest comments.service`. Browser E2E and `npm run perf` are local only. After changing `packages/shared` or `packages/contracts`, rebuild them (`npm run build -w @repo/contracts -w @repo/shared`) before type-checking or testing the apps, and restart any running dev watchers.

## Architecture conventions

- Backends are Hexagonal/DDD: `controller` -> `service` -> `domain entity` -> `repository port` -> adapter. `apps/core_microservice/src/modules/profiles` is the reference module; auth is bare Express with manual DI in `createApp()`.
- Business rules live on entity methods (`static create()`, `publish()`, ...) and throw `DomainError` subclasses from `@repo/shared`. Never throw `HttpException` from domain code; `DomainExceptionFilter` (Nest) and `errorHandler` (Express) map errors to HTTP.
- Services depend on port interfaces, not adapters. Mutating endpoints use the JWT guard plus `@CurrentUser()` and check `user.sub` ownership in the service (IDOR).
- Where a type goes: wire-format request/response in `@repo/contracts`; `class-validator` DTOs in `@repo/shared/dtos`; domain entities and ports in the module's `domain/`. The client imports `@repo/contracts` only, never `@repo/shared`.
- Logs never contain secrets, tokens, cookies or request bodies. Metric labels are bounded (route templates, class names, queue names), never raw URLs or ids.
- Document new HTTP endpoints for Swagger; the core and notifications `openapi` e2e specs fail on an undocumented route ([`docs/API.md`](docs/API.md)).

## Adding a migration

Migrations are per app and run against that app's database (`synchronize` is off). `src/migrations/` holds them; the CLI reads `data-source.ts` at the app root.

```bash
cd apps/core_microservice            # or auth_microservice / notifications_consumer_microservice
npm run migration:generate -- src/migrations/<Name>   # diff entities against the database
npm run migration:run                # same as `npm run db:migrate` for this app
npm run migration:revert             # undo the last one
```

Review the generated SQL: migrations are forward-only in deployments unless reverted explicitly ([`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)). Production containers run them with `migrate:prod` (`node dist/migrate.js`) in the `*-migrate` compose jobs. Add or update the entity and a unit/e2e test in the same change.

## Adding an environment variable

1. Read it through the app's typed config, never `process.env` in feature code: `AppConfigService` in core and notifications, `config/env.ts` in auth, `NEXT_PUBLIC_*` mapping in `apps/client_app/next.config.ts` for the client.
2. If it is required, add it to the validation (`src/config/env.validation.ts` in core and notifications, `config/env.ts` in auth) so the service fails fast at boot and names the variable.
3. Add it to `.env.example` (with a required/optional comment), and to `.env.production.example` if production needs it.
4. Add a row to [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md): service(s), required/optional, default, description.
5. If a container needs it, pass it in `docker-compose.apps.yml`; if the CI build needs it, set it in `.github/workflows/ci.yml`.
6. Extend the config spec (`app-config.service.spec.ts` / `env.validation.spec.ts` / `env.spec.ts`).

## Pull request checklist

- [ ] Branch and commit messages follow the conventions above
- [ ] `npm run lint:check`, `npm run build`, `npm run type-check` pass
- [ ] `test:cov` passes for every touched backend (coverage thresholds hold); new behaviour has unit tests, new endpoints have e2e cases
- [ ] API and browser e2e pass when the change touches endpoints or client flows
- [ ] New or changed endpoints are documented for Swagger; wire types are in `@repo/contracts`
- [ ] Domain rules are on entities and throw `DomainError`; ownership checks are in place
- [ ] Migration included for any schema change, and it runs on a fresh database
- [ ] New env vars follow the checklist above (config, validation, both `.env` examples, `docs/ENVIRONMENT.md`)
- [ ] No secrets, tokens or request bodies in logs; metric labels are bounded
- [ ] Docs updated where behaviour, commands or ports changed (`README.md`, `docs/`, `AGENTS.md`)
