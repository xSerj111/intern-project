/*
 * The auth service's public OpenAPI 3 document, written as a typed object.
 * It replaces `@openapi` JSDoc: auth compiles with `removeComments: true`, so
 * comments never reach `dist/`. Internal-only routes (the `:3012` listener,
 * `/health/details`, `/metrics`) are deliberately left out.
 */

/** The subset of OpenAPI 3.0 this document uses. */
export interface SchemaObject {
  type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean';
  format?: string;
  description?: string;
  example?: unknown;
  enum?: readonly (string | number)[];
  nullable?: boolean;
  minLength?: number;
  required?: readonly string[];
  properties?: Record<string, SchemaObject | ReferenceObject>;
  items?: SchemaObject | ReferenceObject;
  oneOf?: readonly (SchemaObject | ReferenceObject)[];
}

export interface ReferenceObject {
  $ref: string;
}

interface MediaTypeObject {
  schema: SchemaObject | ReferenceObject;
}

interface ResponseObject {
  description: string;
  headers?: Record<string, { description: string; schema: SchemaObject }>;
  content?: Record<string, MediaTypeObject>;
}

interface ParameterObject {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  required?: boolean;
  description?: string;
  schema: SchemaObject;
}

type SecurityRequirement = Record<string, readonly string[]>;

export interface OperationObject {
  summary: string;
  description?: string;
  tags: readonly string[];
  operationId: string;
  security?: readonly SecurityRequirement[];
  parameters?: readonly ParameterObject[];
  requestBody?: { required: boolean; content: Record<string, MediaTypeObject> };
  responses: Record<string, ResponseObject | ReferenceObject>;
}

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export type PathItemObject = Partial<Record<HttpMethod, OperationObject>>;

type SecuritySchemeObject =
  | { type: 'http'; scheme: 'bearer'; bearerFormat?: string; description?: string }
  | { type: 'apiKey'; in: 'cookie' | 'header'; name: string; description?: string };

export interface OpenApiDocument {
  openapi: '3.0.3';
  info: { title: string; version: string; description?: string };
  servers: readonly { url: string; description?: string }[];
  tags: readonly { name: string; description?: string }[];
  paths: Record<string, PathItemObject>;
  components: {
    schemas: Record<string, SchemaObject>;
    responses: Record<string, ResponseObject>;
    securitySchemes: Record<string, SecuritySchemeObject>;
  };
}

/** Must match `REFRESH_COOKIE` in `routes/auth.routes.ts` (asserted in the spec). */
export const REFRESH_COOKIE_NAME = 'refresh_token';

const ref = (name: string): ReferenceObject => ({ $ref: `#/components/schemas/${name}` });
const responseRef = (name: string): ReferenceObject => ({
  $ref: `#/components/responses/${name}`,
});
const json = (
  schema: SchemaObject | ReferenceObject,
): Record<string, MediaTypeObject> => ({
  'application/json': { schema },
});

const SET_REFRESH_COOKIE = {
  'Set-Cookie': {
    description: `The rotated \`${REFRESH_COOKIE_NAME}\` cookie (httpOnly, path \`/auth\`).`,
    schema: { type: 'string' as const },
  },
};

const sessionResponse = (description: string): ResponseObject => ({
  description,
  headers: SET_REFRESH_COOKIE,
  content: json(ref('SessionResponse')),
});

const schemas: Record<string, SchemaObject> = {
  LoginRequest: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', example: 'john.doe@innogram.com' },
      password: { type: 'string', minLength: 8, example: 'Strong@P4ssw0rd!' },
    },
  },
  RegisterRequest: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', example: 'john.doe@innogram.com' },
      password: {
        type: 'string',
        minLength: 8,
        description: 'The account password, at least 8 characters',
        example: 'Strong@P4ssw0rd!',
      },
    },
  },
  GoogleLoginRequest: {
    type: 'object',
    required: ['idToken'],
    properties: {
      idToken: { type: 'string', description: 'The ID token (JWT) issued by Google' },
    },
  },
  AuthUser: {
    type: 'object',
    required: ['id', 'email', 'isEmailVerified', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      isEmailVerified: { type: 'boolean' },
      googleId: { type: 'string', nullable: true },
      roles: { type: 'array', items: { type: 'string' }, nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      deletedAt: { type: 'string', format: 'date-time', nullable: true },
    },
  },
  SessionResponse: {
    type: 'object',
    description: `The refresh token is never in the body; it is set as the httpOnly \`${REFRESH_COOKIE_NAME}\` cookie (path \`/auth\`).`,
    required: ['accessToken', 'user'],
    properties: {
      accessToken: {
        type: 'string',
        description: 'Short-lived JWT for `Authorization: Bearer`',
      },
      user: ref('AuthUser'),
    },
  },
  TokenPayload: {
    type: 'object',
    required: ['sub', 'email'],
    properties: {
      sub: { type: 'string', format: 'uuid', description: 'User id' },
      email: { type: 'string', format: 'email' },
      jti: { type: 'string', description: 'Token id (blacklist key)' },
      sid: { type: 'string', description: 'Session id, stable across refresh rotation' },
      iat: { type: 'integer', description: 'Issued at (Unix seconds)' },
      exp: { type: 'integer', description: 'Expires at (Unix seconds)' },
    },
  },
  MeResponse: {
    type: 'object',
    required: ['statusCode', 'user'],
    properties: {
      statusCode: { type: 'integer', example: 200 },
      user: ref('TokenPayload'),
    },
  },
  LogoutResponse: {
    type: 'object',
    required: ['message'],
    properties: { message: { type: 'string', example: 'Logged out successfully' } },
  },
  HealthResponse: {
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
    },
  },
  Error: {
    type: 'object',
    required: ['message'],
    properties: {
      statusCode: { type: 'integer', example: 401 },
      error: { type: 'string', example: 'UnauthorizedError' },
      message: {
        description: 'One message, or one per failed field on a validation error',
        oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
      },
    },
  },
};

const errorResponse = (description: string): ResponseObject => ({
  description,
  content: json(ref('Error')),
});

const responses: Record<string, ResponseObject> = {
  BadRequest: errorResponse('Validation failed or the JSON body is malformed'),
  Unauthorized: errorResponse('Missing, invalid, expired or revoked credentials'),
  Conflict: errorResponse('A user with this email already exists'),
};

const refreshCookieParam = (required: boolean): ParameterObject => ({
  name: REFRESH_COOKIE_NAME,
  in: 'cookie',
  required,
  description: 'httpOnly refresh token set by login/google/refresh (path `/auth`)',
  schema: { type: 'string' },
});

const paths: Record<string, PathItemObject> = {
  '/auth/login': {
    post: {
      summary: 'Log in with email and password',
      tags: ['Auth'],
      operationId: 'login',
      requestBody: { required: true, content: json(ref('LoginRequest')) },
      responses: {
        '200': sessionResponse('Logged in'),
        '400': responseRef('BadRequest'),
        '401': responseRef('Unauthorized'),
      },
    },
  },
  '/auth/google': {
    post: {
      summary: 'Log in or register with a Google ID token',
      tags: ['Auth'],
      operationId: 'loginWithGoogle',
      requestBody: { required: true, content: json(ref('GoogleLoginRequest')) },
      responses: {
        '200': sessionResponse('Logged in'),
        '400': responseRef('BadRequest'),
        '401': responseRef('Unauthorized'),
      },
    },
  },
  '/auth/me': {
    get: {
      summary: "Get the current access token's payload",
      tags: ['Auth'],
      operationId: 'me',
      security: [{ bearerAuth: [] }],
      responses: {
        '200': { description: 'The token payload', content: json(ref('MeResponse')) },
        '401': responseRef('Unauthorized'),
      },
    },
  },
  '/auth/refresh': {
    post: {
      summary: 'Rotate the refresh token and issue a new access token',
      description: `Reads the \`${REFRESH_COOKIE_NAME}\` cookie, rotates it (the cookie is replaced) and returns a new access token. No request body.`,
      tags: ['Auth'],
      operationId: 'refresh',
      security: [{ refreshCookie: [] }],
      parameters: [refreshCookieParam(true)],
      responses: {
        '200': sessionResponse(
          'New access token in the body, new refresh token in the cookie',
        ),
        '401': responseRef('Unauthorized'),
      },
    },
  },
  '/auth/logout': {
    post: {
      summary: 'Log out: revoke the refresh token and, when sent, the access token',
      description: `Revokes the \`${REFRESH_COOKIE_NAME}\` cookie's session and clears the cookie. The bearer token is optional; when present and still valid, it is blacklisted until it expires. Succeeds without either.`,
      tags: ['Auth'],
      operationId: 'logout',
      security: [{ refreshCookie: [], bearerAuth: [] }, { refreshCookie: [] }, {}],
      parameters: [refreshCookieParam(false)],
      responses: {
        '200': { description: 'Logged out', content: json(ref('LogoutResponse')) },
      },
    },
  },
  '/users/register': {
    post: {
      summary: 'Register a new user with email and password',
      description: 'Creates the account only; log in afterwards to get a session.',
      tags: ['Users'],
      operationId: 'register',
      requestBody: { required: true, content: json(ref('RegisterRequest')) },
      responses: {
        '201': { description: 'User created', content: json(ref('AuthUser')) },
        '400': responseRef('BadRequest'),
        '409': responseRef('Conflict'),
      },
    },
  },
  '/health': {
    get: {
      summary: 'Overall service health',
      description: 'Status only; per-dependency details are internal-only.',
      tags: ['Health'],
      operationId: 'health',
      responses: {
        '200': {
          description: 'Healthy or degraded',
          content: json(ref('HealthResponse')),
        },
        '503': { description: 'Unhealthy', content: json(ref('HealthResponse')) },
      },
    },
  },
};

export function buildOpenApiDocument(serverUrl: string): OpenApiDocument {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Innogram Auth API',
      version: '1.0.0',
      description:
        'Credentials, Google login and JWT sessions. Login responses carry `accessToken` and `user`; the refresh token is only ever the httpOnly `refresh_token` cookie.',
    },
    servers: [{ url: serverUrl }],
    tags: [
      { name: 'Auth', description: 'Sessions and tokens' },
      { name: 'Users', description: 'Account registration' },
      { name: 'Health', description: 'Liveness for load balancers' },
    ],
    paths,
    components: {
      schemas,
      responses,
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        refreshCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: REFRESH_COOKIE_NAME,
          description:
            'httpOnly refresh token cookie (path `/auth`); browsers send it automatically',
        },
      },
    },
  };
}
