# Auth Contract

**Endpoint**: `POST /auth/login` (auth_microservice, port 3002)

## Request

```ts
// @repo/contracts — auth/requests.ts
export interface ILoginRequest {
  email: string;      // valid email format (mirrors LoginDto @IsEmail)
  password: string;   // min length 8 (mirrors LoginDto @MinLength(8))
}
```

## Response (200)

```ts
// @repo/contracts — auth/responses.ts
export interface IAuthUserResponse {
  id: string;              // auth user id == JWT `sub`
  email: string;
  isEmailVerified: boolean;
  roles?: string[];        // future RBAC; may be absent
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
}

export interface ILoginResponse {
  accessToken: string;     // JWT, attached as `Authorization: Bearer <token>`
  refreshToken: string;    // opaque; stored but not exercised in the baseline
  user: IAuthUserResponse;
}
```

## JWT payload

Signed by the auth service with `JWT_SECRET`; verified by `core_microservice`'s `JwtAuthGuard`.

```ts
{ sub: string; email: string }
```

`sub` is the auth user id, used by `GET /profiles/me` to resolve the caller's profile.

## Error responses

| Status | Condition |
|--------|-----------|
| 400 | Validation error (bad email / short password) |
| 401 | Invalid credentials |

## Client notes

- The client stores `accessToken`, `refreshToken`, and `user` in `localStorage` and re-hydrates on load (see [research.md](../research.md) §6).
- The baseline does not exercise `POST /auth/refresh`, `POST /auth/google`, or `POST /auth/logout` (available but deferred).
