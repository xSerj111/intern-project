# Profile Contract

**Endpoint**: `GET /profiles/me` (core_microservice, port 3001) — **new route** in this feature.

## Request

No path/query parameters. Authentication required: `Authorization: Bearer <jwt>` (guarded by `JwtAuthGuard`). The route resolves the caller's profile via `authUserId === JWT sub`.

## Response (200)

`IProfileResponse` — already defined in `@repo/contracts` (`profiles/responses.ts`); reused, not re-declared.

```ts
export interface IProfileResponse {
  id: string;            // profile UUID (not the auth user id)
  authUserId: string;    // == JWT `sub`
  username: string;      // handle, e.g. `@john_doe`
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: string;     // ISO 8601
  updatedAt: string;     // ISO 8601
}
```

## Error responses

| Status | Condition |
|--------|-----------|
| 401 | Missing / invalid JWT |
| 404 | No profile exists for the authenticated user (lazy-init not yet run) |

## Client notes

- The client renders `displayName`, `username`, `bio`, `avatarUrl` on the Profile section.
- The profile `id` is distinct from `authUserId`; the client never needs the profile `id` in the baseline — `GET /profiles/me` removes the need to discover it.

## Backend change (additive)

New controller method in `core_microservice/src/modules/profiles/profiles.controller.ts`:

- `@Get('me')` + `@UseGuards(JwtAuthGuard)`, `@CurrentUser('sub') authUserId`.
- Calls `ProfilesService` (a new `getProfileByAuthUserId(authUserId)` wrapper over the existing `UserProfileRepository.findByAuthUserId`), returns `ProfileResponseDto`.
- No schema change, no migration.
