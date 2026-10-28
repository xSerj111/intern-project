# Innogram Constitution

Innogram is a Turborepo + npm-workspaces monorepo (Node 20, TypeScript) implementing a
microservices social media application. This constitution governs the project's
non-negotiable architectural principles and how they may change.

## Core Principles

### I. Microservice Autonomy & Domain Ownership
Each backend service owns its domain and its own database. Services MUST NOT read or write
another service's tables directly; cross-service interaction MUST flow through explicit
ports (HTTP events / message contracts). Configuration is centralized in one root `.env`,
but each service MUST use its own port and database variables (never a shared `PORT`).

Rationale: prevents hidden coupling and "God Object" modules; keeps each service
independently deployable and testable.

### II. Hexagonal Architecture (Ports & Adapters)
Backend services follow Ports & Adapters layering: domain entities and port interfaces under
`domain/`, application services, and infrastructure adapters under `infrastructure/`.
Services MUST depend on port interfaces, never concrete adapters. Business rules MUST live
in domain entities (factory and domain methods), never in controllers, routes, or services.

Rationale: keeps the domain framework-agnostic and unit-testable; adapters can be swapped
without touching domain logic.

### III. Package Boundary: `@repo/contracts` vs `@repo/shared`
Shared code is split by consumer. Wire-format request/response types MUST go in
`@repo/contracts` (zero runtime dependencies, safe for a future frontend). Backend
infrastructure (TypeORM base classes, `class-validator` DTOs, domain errors, logger, filters)
MUST go in `@repo/shared`, which MUST NOT be imported by frontend code. Choose the package by
consumer when adding any shared type.

Rationale: this is the most important boundary in the repo — it keeps the frontend free of
the backend stack (typeorm/nestjs/winston).

### IV. Domain Errors over Framework Exceptions
Domain and data-access code MUST signal failure with `DomainError` subclasses from
`@repo/shared`, mapped to HTTP by the framework layer (`DomainExceptionFilter` in NestJS,
`errorHandler` in Express). Domain code MUST NOT throw framework exceptions (e.g.
`HttpException`) or reference HTTP status codes.

Rationale: business rules stay transport-agnostic; error semantics are centralized and
consistent across services.

### V. Security & Ownership Enforcement (Non-Negotiable)
Mutating endpoints MUST authenticate via JWT and verify resource ownership before applying
changes (compare authenticated `user.sub` to the resource owner — IDOR protection). Secrets
MUST be loaded from the root `.env` (never committed) and validated fail-fast at startup.
Internal-only endpoints (e.g. `POST /internal/events/*`, `GET /internal/users/:id/contact`)
MUST NOT be publicly exposed. Operational endpoints (metrics, detailed health) MAY be served
on a service's public port only when every request is authenticated with `X-Internal-Token`
compared in constant time; any unauthenticated health check MUST return overall status only,
with no dependency names or details.

Rationale: these are correctness and safety invariants, not stylistic preferences.

## Architecture & Data Constraints

- Schema changes MUST go through TypeORM migrations (`synchronize: false`), run per service
  via `npm run migration:run` from the app directory. Root `db:migrate`/`db:seed` are no-ops.
- Build order matters: `@repo/shared` and `@repo/contracts` are consumed via their built
  `dist/`, so upstream packages MUST be built before downstream apps.
- Auth → Core profile creation uses HTTP fire-and-forget (`POST /internal/events/user-created`)
  with a lazy-initialization fallback; it MUST NOT be treated as reliable delivery.

## Development Workflow & Quality Gates

- CI (`.github/workflows/ci-pipepline.yml`) enforces lint → build (type-check surrogate) →
  unit tests with coverage thresholds for core, auth and notifications. Changes MUST pass
  these gates before merge.
- Unit tests are Jest `*.spec.ts` (rootDir `src`); write specs alongside the code they verify.
- Lint uses per-app flat `eslint.config.mjs` (with `--fix`); formatting is Prettier
  (`singleQuote: true`, `trailingComma: "all"`).
- Use `feature/INO-XXX` feature branches; keep changes focused and testable.

## Governance

- This constitution supersedes conflicting guidance in `README.md`, `AGENTS.md`, and
  `DDD_ARCHITECTURE_GUIDE.md`; the architecture guide remains the detailed reference and is
  subordinate to these principles.
- Amendments require a documented rationale and a semantic-version bump (MAJOR: principle
  removal or redefinition; MINOR: new principle or section; PATCH: wording/clarification).
- Every pull request MUST be reviewed for compliance with Core Principles I–V; violations
  MUST be raised in review.

**Version**: 1.1.1 | **Ratified**: 2026-09-23 | **Last Amended**: 2026-10-21
