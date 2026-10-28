Before: baseline (legacy, 51d384d-dirty)  After: final (current, 199ac0e-dirty)

| endpoint | p50 before→after | p95 before→after (Δ%) | errors | queries/req before→after | flag |
|---|---|---|---|---|---|
| feed | 64.2→41.2 ms | 79.3→52.7 ms (-33.6%) | 0.00%→0.00% | 6→4 |  |
| profile | 26.7→20.4 ms | 37→29.3 ms (-20.7%) | 0.00%→0.00% | 5→1 |  |
| comments | 30→24.5 ms | 43.5→45.7 ms (+5.1%) | 0.00%→0.00% | 2.1→2.9 | no gain (SC-002) |
| profile_search | 16.2→15.2 ms | 24.4→22.1 ms (-9.6%) | 0.00%→0.00% | 1→1 | no gain (SC-002) |
| chat_list | 25.4→25 ms | 64.6→49.4 ms (-23.6%) | 0.00%→0.00% | 3→3.1 | no gain (SC-002) |
| post_create_image | 99→168 ms | 123→201 ms (+63.4%) | 0.00%→0.00% | 11→16 | no gain (SC-002) |

## Notes on flagged endpoints (SC-002)

Both reports come from the same environment: `perf` seed v1, 20 VUs, 30 s ramp, 120 s hold, 15 s warm-up, core with `PERF_INSTRUMENTATION=true`. Gate thresholds were not changed. Every p95 is far below the 300 ms limit (post creation with an image is far below 1000 ms), and every error rate is 0%.

SC-002 covers feed, public profile and post comments:

- **feed**: p95 79.3 → 52.7 ms (-33.6%) and 6 → 4 queries per request. Meets SC-002 on both measures.
- **profile**: p95 37 → 29.3 ms (-20.7%) and 5 → 1 queries per request (profile cache). Meets SC-002 through the lower query count. Cache hit ratio during the run was 0.99.
- **comments** (flagged, no gain on either measure): p95 43.5 → 45.7 ms (+5.1%, +2.2 ms) and 2.1 → 2.9 queries per request.
  - Query count: comments are now paged. The page of root comments is read with a `take` plus the joined author, which TypeORM runs as an id query and a load query. The replies of those roots then take a recursive id query and a load query when the page has replies. The old flat `findByPost` was one query plus the duplicate author lookup (now dropped). Fetching a bounded page in a few indexed queries replaces one unbounded read, so the query count rises slightly by design (plan, B2/B3).
  - Latency: the win is bounded work per request (page size capped at 50 roots) and index scans instead of sequential scans. In isolation the `EXPLAIN` evidence in research §8 shows root page 5.7 → 0.5 ms and replies 17.7 → 0.1 ms (`IDX_comments_post_roots`, `IDX_comments_parent`). The perf seed gives each post only a few comments (about 50,000 comments over 25,000 posts), so the old query returned a handful of rows and the saving is under 1 ms per request. At this load the p95 is dominated by guard, Redis blacklist check and HTTP overhead, so the saving does not show in the p95.
  - The +2.2 ms is slightly above the run-to-run spread seen in the repeatability check (at most 2.4%) but is 15% of the 300 ms budget at most and has no effect on the gate.

Other flagged rows (not part of SC-002):

- **profile_search**: p95 24.4 → 22.1 ms (-9.6%), 1 query before and after. The query was already a single `ILIKE 'q%'` lookup over about 1,400 profiles, which is fast without an index at this size. The `lower(username) text_pattern_ops` index matters as the table grows, not at this seed size.
- **chat_list**: p95 64.6 → 49.4 ms (-23.6%), 3 → 3.1 queries per request. The unread `COUNT` was checked and is not a per-row query (research §8 addendum), so no query rewrite was made. The p95 drop comes from the surrounding changes (the capped page size, `limit` handling), not from fewer queries.
- **post_create_image**: p95 123 → 201 ms (+63.4%), 11 → 16 queries per request. This is the expected cost of the new upload flow (FR-021): instead of one multipart `POST /assets/upload` through core, the sample is now four requests: `POST /uploads` (signed link), the direct upload to object storage, `POST /uploads/:id/confirm` (reads the leading bytes, checks type and size) and `POST /posts`. The extra queries are the pending-upload row and its confirm step. The gain is not latency but memory: file bytes no longer pass through core (see `perf:upload-memory`). The result is still within the 1000 ms limit.
