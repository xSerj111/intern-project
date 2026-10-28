# Load and performance tests

k6 load tests and the fan-out benchmark for the core microservice. They measure the six key endpoints under a fixed load profile, gate the build on latency and error thresholds, and record reports for before/after comparison.

Contract: `specs/004-testing-performance/contracts/perf-tooling.md`. Thresholds: `test/load/k6/thresholds.js`.

## Commands

Run from the repository root unless noted.

| Command | What it does | Exit code |
|---------|--------------|-----------|
| `npm run db:seed -w auth_microservice -- --profile perf --reset` | Seeds the deterministic perf user set in auth. Run it first. | 0 on success |
| `npm run db:seed -w core_microservice -- --profile perf --reset` | Seeds the matching perf profiles, posts and follows in core. | 0 on success |
| `npm run perf:baseline` | k6 `MODE=measure` over the six key endpoints. Writes `apps/core_microservice/test/load/reports/$REPORT.json` (`REPORT` defaults to `baseline`). | 0 unless k6 or setup crashes |
| `npm run perf:compare -- baseline final` | Prints a Markdown before/after table to stdout. `--repeatability a b` fails if any p95 differs by more than 20%. | 0, or 1 on a repeatability failure |
| `npm run perf` | k6 `MODE=gate` (thresholds), then `group-fanout.ts --members 100 --messages 50`. Prints the per-endpoint p50/p95 table. | 0 if all pass; non-zero naming `endpoint:metric` otherwise |
| `npm run perf:upload-memory -w core_microservice` | 20 concurrent 10 MiB uploads through the new flow. Samples `process_resident_memory_bytes` from `/metrics` every 250 ms. | 0 if peak minus start is under 50 MiB and every upload is confirmed |
| `npm run test:cov -w core_microservice` | Jest unit tests with coverage thresholds of 70 lines and 60 branches. | non-zero if a test fails or a threshold is missed |

Environment inputs (all optional):

- `CORE_URL` (default `http://localhost:3001`)
- `AUTH_URL` (default `http://localhost:3002`)
- `CLIENT_URL` (default `http://localhost:3000`)
- `FLOW` (`legacy` for the baseline, `current` afterwards)
- `INTERNAL_API_TOKEN` (required by `perf:upload-memory` and by the cache hit-ratio scrape)

Perf users are `perf0001` to `perf1000` at `@innogram.dev`, password `PerfPassword123!`. The load test logs in the first 200 of them during `setup()`.

## Load profile

| Setting | Value |
|---------|-------|
| Virtual users | 20, constant after the ramp |
| Ramp / hold / warm-up | 30 s / 120 s / 15 s. Warm-up requests are excluded from the metrics. |
| Think time | none |
| Users | the first 200 perf users, logged in during `setup()` |
| Scenario mix per iteration | feed page (20 posts) → public profile of a random followed user → comments of a random feed post → profile search (2–3 character prefix) → chat list → every 5th iteration: post creation with a 512 KB–1 MB PNG |
| Tags | `endpoint=<key>` on every request, and on every sub-request of `post_create_image` |

## Thresholds

Gate mode (`npm run perf`) enforces these. Source of truth: `test/load/k6/thresholds.js`.

| Metric | Endpoint key(s) | Limit |
|--------|-----------------|-------|
| `http_req_duration` p95 | `feed`, `profile`, `comments`, `profile_search`, `chat_list` | < 300 ms |
| `post_create_image_duration` p95 (sign, upload ≤ 1 MB, confirm, create) | `post_create_image` | < 1000 ms |
| `http_req_failed` rate | every endpoint key | < 0.01 |
| Fan-out p95 (`group-fanout.ts`) | chat fan-out | < 2000 ms, zero missing deliveries |
| Profile cache hit ratio (`run-k6.sh`) | `cache:profileHitRatio` | ≥ 0.80 |

The k6 thresholds use `abortOnFail: false`, so a run finishes and reports every failing threshold.

The cache hit ratio is computed by `run-k6.sh` from `cache_requests_total` on core `/metrics` (scraped with `X-Internal-Token`), taken before and after the k6 run. The delta includes warm-up traffic, so the check is conservative: warm-up misses can only lower the ratio.

## Reference environment

Record numbers only from this setup. Each report stores its environment in the `environment` field.

- A developer machine with at least 4 cores and 16 GB RAM, running Linux.
- Infrastructure started with `docker compose up`.
- Services run as `node dist/main` with `NODE_ENV=development`.
- `PERF_INSTRUMENTATION=true` only for measure runs (`perf:baseline`). Do not set it for gate runs.
- Logging at `info`.

k6 runs in the `grafana/k6:1.0.0` Docker image with `--network host`, so it reaches the services on localhost.

## How to read a failure

1. **k6 exit code 99** means a threshold failed. The service responded, but a metric missed its limit. Read the threshold lines in the k6 summary first. Each one names the metric and the endpoint tag, for example `http_req_duration{endpoint:feed}`.
2. **`FAILED cache:profileHitRatio <v> < 0.80`** means the profile cache hit ratio was too low. Check that Redis is up and that the cache is enabled. Then rerun, because a cold cache right after seeding lowers the ratio.
3. **A latency threshold failed, errors are zero** means the endpoint is slow, not broken. Compare with the last good report using `npm run perf:compare -- <previous> <current>`. Check the `queriesPerRequest` column first, since a jump there usually means an N+1 query.
4. **An `http_req_failed` threshold failed** means requests returned errors or timed out. Check the core logs at `info` for the status codes. Confirm the seed ran with `--reset` and that auth is reachable on `AUTH_URL`.
5. **Fan-out fails** on latency or missing deliveries. Check that the realtime gateway and RabbitMQ are running, then rerun `group-fanout.ts` on its own.
6. **`perf:upload-memory` fails** with peak minus start at or above 50 MiB, or with unconfirmed uploads. Check for buffers kept after upload and for uploads that never reach the confirm step. Confirm `INTERNAL_API_TOKEN` is set.
7. **`perf:compare --repeatability` exits 1** when two runs of the same build differ by more than 20% on any p95. The environment is noisy. Close other load on the machine and run again before you trust any comparison.

Do not compare reports that differ in `environment`, `seed.version` or `loadProfile`. The comparison is only meaningful when those match.

## Reports

Reports are written to `test/load/reports/<name>.json`. The `reports/` directory holds a `.gitkeep` so it exists in a fresh checkout.
