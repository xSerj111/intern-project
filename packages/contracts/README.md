# @repo/contracts

Wire-format types for the Innogram HTTP APIs: request and response interfaces, shared between the services and the web client.

## What goes where

Follow the rule in [AGENTS.md](../../AGENTS.md):

| Kind of code                                                        | Goes in                                  |
| ------------------------------------------------------------------- | ---------------------------------------- |
| Wire-format request and response interfaces                         | `@repo/contracts` (here)                 |
| Backend-only infrastructure (base classes, filters, logger, errors) | `@repo/shared` (`packages/shared`)       |
| `class-validator` DTOs                                              | `@repo/shared/dtos`                      |
| Domain entities and ports                                           | The owning app module's `domain/` folder |

## Dependency-free

This package has no runtime or dev dependencies. Keep it that way: it must stay importable from the browser. Do not add NestJS, TypeORM, class-validator or any other backend library here.

## Import boundary

- `apps/client_app` imports `@repo/contracts`, and only this package from the shared set. It never imports `@repo/shared`.
- The backend apps import both packages.

## Build before use

`main` and `types` point at `dist/`, so build before an app that uses it is type-checked, run or built:

```bash
npm run build -w @repo/contracts          # tsc -p tsconfig.build.json -> dist/
npm run type-check -w @repo/contracts     # tsc --noEmit
```

Turborepo runs the build for `build`, `test` and `dev`. Standalone runs need the build first. Rebuilding also deletes `dist/` under any running dev watcher, so restart the services that use it.
