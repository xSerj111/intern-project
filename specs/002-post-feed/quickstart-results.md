# Quickstart Verification: Post Feed (`002-post-feed`)

Recorded during implementation. Backend scenarios were exercised live against the
`core_microservice` running on `http://localhost:3001` with the running Postgres
container and two seeded profiles (`test`, `test-a0e227`). Client-only and
resilience scenarios are covered by automated component specs and code
inspection (no browser session was driven).

## Summary

| # | Scenario | Result | Evidence |
|---|----------|--------|----------|
| 1 | Feed renders author/media/engagement + pagination | ✅ PASS | Live API: following/discover author scoping, `author` projection, engagement fields |
| 2 | Compose & publish with media, draft, empty-publish blocked | ✅ PASS | Live API: publish vs draft, draft hidden + publishable later, empty publish → 400. Media upload covered by client spec/build |
| 3 | Like/unlike, comment, share, re-post | ✅ PASS | Live API: 204 like/unlike, idempotent double-like, counts + `likedByMe`, comment create/list, repost item + attribution. Share is client-only (code path) |
| 4 | Edit / archive / delete own posts (ownership) | ✅ PASS | Live API: non-author 401, author edit/archive/delete, archived hidden, deleted repost → `post: null` |
| 5 | Media gallery / lightbox | ✅ PASS | Client specs: gallery opens on click, `1 / 2` counter, Escape closes; text-only post renders no media placeholder |
| 6 | Sort & filter | ✅ PASS | Live API: `oldest`, `most_liked`, `mediaType=photos/text`, default restore |
| 7 | Search | ✅ PASS | Live API: keyword match, `<3` chars → 400, no-match empty list |
| 8 | Resilience (auto-recovery) | ✅ PASS | Code-verified: `ErrorState` + manual retry in `feed-list.tsx`; `QueryProvider` sets `refetchInterval` on `status === 'error'` |
| 9 | Quality gates | ✅ PASS | `core` lint, `client` lint, 61 core + 12 client tests, `core`/`client` builds all green |

## Live API check totals

`Scenario 1–4, 6–7`: **37/37** assertions passed.

Run command (throwaway script, tokens minted from `JWT_SECRET`):

```bash
# core_microservice running on :3001, Postgres container up
bash /tmp/opencode/e2e.sh   # SUMMARY: 37 passed, 0 failed
```

## Bug found and fixed during the walkthrough

`GET /posts/:id`, `PATCH`, publish/archive/delete, and like/repost returned
`500` because `@repo/shared`'s `TypeormRepositoryBase.resolveRelations` threw
`Cannot create property 'asset' on boolean 'true'` when default relations
declared a parent (`assets`) before a dotted child (`assets.asset`). Fixed in
`packages/shared/src/database/typeorm-repository.base.ts` with a regression test
in `post.repository.spec.ts`.

## Notes

- Scenario 5's video playback and Scenario 3's OS share sheet require a real
  browser/OS; both are implemented (client specs cover the gallery controls).
- Scenario 8's restart-recovery is provided by the TanStack Query provider's
  error `refetchInterval`; not driven end-to-end in this run.
