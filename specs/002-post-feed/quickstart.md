# Quickstart: Post Feed

Validation guide for `002-post-feed`. Proves each user story / success criterion end-to-end without reproducing implementation code. Contract shapes are referenced from [contracts/](./contracts/README.md); data concepts from [data-model.md](./data-model.md).

## Prerequisites

- Node 20, npm (monorepo uses npm workspaces + Turborepo).
- PostgreSQL, Redis, and MinIO running (`docker-compose up` per the repo; MinIO for media).
- A seeded backend with at least **two** registered users (so one can follow the other) and some published posts. Profile creation is fire-and-forget on registration (lazy-init fallback via `GET /profiles/me`).
- Root `.env` present (`cp .env.example .env`) with service URLs, S3/MinIO, and JWT secret set.

## One-time setup

```bash
# from repo root
npm install
cp .env.example .env                       # review values
npm run docker:up                          # Postgres + Redis (+ MinIO)
npm run migration:run -w core_microservice # applies the new `reposts` migration
npm run migration:run -w auth_microservice
npm run build -w @repo/contracts -w @repo/shared   # upstream dist (turbo handles in dev/build)
```

## Scenario 1 — Feed renders with author, media, engagement (US-1, FR-001/002/023, SC-001/011)

```bash
npm run dev   # open http://localhost:3000
```

1. Sign in (seeded user). The Home feed shows **Following** by default: the user's own posts + followed accounts' posts, newest-first.
2. Switch to **Discover**: all public posts appear, newest-first.
3. Confirm each card shows the author (name/handle), text, media thumbnails, and like/comment counts.
4. Scroll to the bottom: the next page loads without a full-page reload (progressive pagination).

## Scenario 2 — Compose & publish with media (US-2, FR-004–007/024/025, SC-002/003/012)

1. Open **Compose** (`/compose`), type text, attach an image/video (≤ 10 MB, image/video type).
2. **Publish**: the post appears in the feed with its media (100% of valid posts — SC-002).
3. **Save draft**: the post is saved and does **not** appear in feeds until published (FR-024/025).
4. Attempt an empty publish (no text, no media): blocked with a clear message (FR-007).
5. Attach an oversized or non-image/video file: upload rejected with a friendly error, no post created (FR-006).

## Scenario 3 — Like / unlike, comment, share, re-post (US-3, FR-011–014, SC-004/010)

1. **Like** a post: state toggles to liked and the count updates; like again → unliked (consistent, SC-004).
2. **Comment**: write and submit a comment; it appears with the post and is visible to others.
3. **Share → copy link**: the post link is copied; **Share → native sheet**: the OS share sheet opens (FR-013).
4. **Re-post**: the post appears in your feed with "reposted by you" and attribution to the original author (FR-014, SC-010).

## Scenario 4 — Edit / archive / delete own posts (US-4, FR-008–010/026/027, SC-005)

1. Edit text **and** media of your own post: changes persist.
2. **Archive** a published post: it disappears from feeds but is retained for you.
3. **Delete** a post (confirming the prompt): it and its comments/likes vanish everywhere; any re-post of it shows a "post unavailable" placeholder (FR-027).
4. On **another user's** post, confirm edit/archive/delete are not offered, and a direct (e.g. curl) attempt is denied (0% success — SC-005).

## Scenario 5 — Media gallery / lightbox (US-5, FR-015/016, SC-006)

1. Open a post with multiple images/videos: media renders inline.
2. Select an item: it opens full-screen; navigate forward/backward; play a video with controls.
3. A text-only post renders cleanly with no media placeholder (FR-016).

## Scenario 6 — Sort & filter (US-6, FR-017–019, SC-007)

1. Change sort to **oldest** then **most-liked**: the feed reorders to match, in under 2 s.
2. Apply a media-type filter (photos / videos / text): only matching posts show.
3. Clear the filter/sort: the default (newest) full feed returns.

## Scenario 7 — Search (US-7, FR-020–022, SC-008)

1. Open **Search** (`/search`) and submit a keyword: matching posts appear.
2. Submit a keyword with no matches: a friendly "no results" state shows.
3. Submit a term shorter than the minimum (3 chars): prompted to enter a longer term.

## Scenario 8 — Resilience (FR-003)

Stop the core service, open the feed: a friendly error/retry state appears; restart the service: the feed recovers automatically (no reload).

## Scenario 9 — Quality gates

```bash
npm run lint
npm run test -w core_microservice   # new entity/service/controller specs
npm run test -w client_app         # component specs
npm run build                      # type-check surrogate (turbo run build)
```

**Expected**: lint, unit tests, and build all pass.
