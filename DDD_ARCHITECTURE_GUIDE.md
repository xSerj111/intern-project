# DDD & Hexagonal Architecture Guide — Innogram Monorepo

**Audience:** Backend and full-stack developers working in the Innogram codebase.  
**Last updated:** 2026-07-29  
**Monorepo root:** `intern-project/`

---

## 1. System Overview & Turborepo Flow

### 1.1 Monorepo Topology

The repository is a **Turborepo-powered monorepo** organized as follows:

```
intern-project/
├── apps/
│   ├── auth_microservice/          # Authentication & user identity (Express.js + Ports & Adapters DDD)
│   ├── core_microservice/          # Social graph, content, interactions (NestJS + Hexagonal Architecture)
│   ├── notifications_consumer_microservice/  # Async event consumers
│   └── client_app/                 # Frontend (consumes @repo/contracts)
├── packages/
│   ├── contracts/                  # → @repo/contracts (zero-dependency API shapes)
│   └── shared/                     # → @repo/shared    (backend infrastructure)
├── turbo.json                      # Turborepo pipeline definition
├── package.json                    # Workspace root (workspaces: ["apps/*", "packages/*"])
└── tsconfig.json
```

### 1.2 Architectural Styles

The monorepo employs **two distinct architectural approaches** tailored to each microservice's complexity:

| Microservice | Framework | DI Strategy | Architecture |
|---|---|---|---|
| `auth_microservice` | Bare Express.js | Manual Dependency Injection | Hexagonal Architecture (Ports & Adapters) with DDD layering |
| `core_microservice` | NestJS | NestJS IoC container (`@Injectable`) | Full Hexagonal Architecture (Ports & Adapters) |

**Why the same architectural style?** Both microservices now follow the Ports & Adapters pattern. `auth_microservice` achieves it with manual DI and Express router factories instead of NestJS decorators, but the layering — domain entities, port interfaces, infrastructure adapters — is the same. `core_microservice` uses NestJS IoC for wiring; the architectural principles are identical. The key difference is that `auth_microservice` has a narrower domain scope (register, login, token management, Google OAuth) and uses a lightweight framework.

Both services share `@repo/shared` (TypeORM base classes, DTOs, domain errors, logger) and `@repo/contracts` (API contracts).

### 1.3 How Turborepo Orchestrates Builds

The root `turbo.json` defines the build pipeline:

```jsonc
// turbo.json (excerpt)
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],     // "^build" = build upstream dependencies first
      "outputs": ["dist/**"]
    },
    "dev":    { "dependsOn": ["^build"], "cache": false, "persistent": true },
    "test":   { "dependsOn": ["^build"] },
    "lint":   {},
    "type-check": { "dependsOn": ["^build"] }
  }
}
```

**The `^build` prefix means:** For every task `build` in workspace `X`, Turborepo first runs `build` in all workspaces that `X` depends on. Concretely:

```
packages/contracts   ──build──▶  dist/
packages/shared      ──build──▶  dist/     (depends on contracts? No — contracts is dep-free)
apps/core_microservice ──build──▶ dist/    (depends on @repo/shared, @repo/contracts)
apps/auth_microservice  ──build──▶ dist/   (depends on @repo/shared, @repo/contracts)
apps/client_app         ──build──▶ build/  (depends on @repo/contracts)
```

This ensures the shared packages are compiled before any app consumes them. Running `npm run build` at the root triggers `turbo run build`, which traverses the dependency graph and builds in correct topological order — with parallel execution where possible.

---

## 2. The Package Ecosystem: `@repo/contracts` vs. `@repo/shared`

This is the single most important architectural boundary in the monorepo. These two packages serve **fundamentally different consumers**.

### 2.1 `@repo/contracts` — The API Contract Layer

| Property       | Value |
|----------------|-------|
| Package name   | `@repo/contracts` |
| Dependencies   | **None** (zero runtime deps) |
| Consumed by    | `client_app` (frontend), all microservices |
| Purpose        | Define the **wire format** — the shape of requests and responses |

**Contents:**

```
packages/contracts/src/
├── index.ts                    # Re-exports everything
├── common/
│   ├── index.ts
│   └── responses.ts            # IPaginatedResponse<T>, IPaginationMeta, PAGINATION_DEFAULTS
└── profiles/
    ├── index.ts
    ├── requests.ts             # ICreateProfileRequest, IUpdateProfileRequest
    └── responses.ts            # IProfileResponse
```

Each interface is a **pure TypeScript type** — no decorators, no runtime libraries, no NestJS, no TypeORM:

```typescript
// packages/contracts/src/profiles/requests.ts
export interface ICreateProfileRequest {
  authUserId: string;
  handle: string;          // e.g. "@john_doe"
}

export interface IUpdateProfileRequest {
  displayName?: string;
  bio?: string | null;     // null means "clear the bio"
  avatarUrl?: string | null;
}
```

```typescript
// packages/contracts/src/profiles/responses.ts
export interface IProfileResponse {
  id: string;
  authUserId: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: string;       // ISO 8601 string, not Date
  updatedAt: string;
}
```

**Why this matters:** The frontend (`client_app`) imports `@repo/contracts` to type its HTTP client calls. Because the package has no dependencies, the frontend bundles no backend code (no TypeORM, no NestJS, no Winston). The contract is the single source of truth for the API surface.

### 2.2 `@repo/shared` — The Backend Infrastructure Toolkit

| Property       | Value |
|----------------|-------|
| Package name   | `@repo/shared` |
| Dependencies   | `@nestjs/common`, `@nestjs/swagger`, `class-validator`, `class-transformer`, `typeorm`, `winston` |
| Consumed by    | Backend microservices only — **never** the frontend |
| Purpose        | Provide reusable backend infrastructure: DTOs, base classes, ports, errors, logging, exception filters |

**Contents (grouped by concern):**

```
packages/shared/src/
├── index.ts                              # Central barrel export
│
├── dtos/
│   ├── auth/
│   │   ├── create-user.dto.ts            # CreateUserDto (auth microservice)
│   │   └── login.dto.ts                  # LoginDto (auth microservice — class-validator decorated)
│   └── core/
│       ├── create-post.dto.ts            # CreatePostDto
│       ├── update-post.dto.ts            # UpdatePostDto
│       ├── create-comment.dto.ts         # CreateCommentDto
│       ├── update-comment.dto.ts         # UpdateCommentDto
│       └── update-profile.dto.ts         # UpdateProfileDto
│
├── database/
│   ├── typeorm-entity.base.ts            # TypeormEntityBase (id, createdAt, updatedAt, deletedAt)
│   ├── repository.port.ts               # RepositoryPort<Entity, EntityProps> interface
│   ├── typeorm-repository.base.ts        # TypeormRepositoryBase<Entity, EntityProps> (adapter)
│   ├── postgres-error-code.enum.ts       # PostgresErrorCode enum (23505, etc.)
│   └── typeorm-error.guard.ts           # isTypeOrmError() type guard
│
├── errors/
│   ├── domain.error.ts                   # DomainError abstract base class
│   └── database.errors.ts                # Concrete errors: EntityByIdNotFoundError, UnauthorizedError, etc.
│
├── filters/
│   └── domain-exception.filter.ts        # DomainExceptionFilter (domain errors → HTTP — NestJS only)
│
├── logger/
│   ├── logger.port.ts                    # Logger interface + LoggerKey DI token
│   ├── winston.logger.ts                 # WinstonLogger (default implementation)
│   └── index.ts
│
└── events/
    └── user-created.event.ts             # UserCreatedEvent (shared event payload)
```

**Key additions for the Express migration:**

- `LoginDto` — class-validator-decorated DTO (`@IsEmail`, `@MinLength(8)`) used by `auth_microservice`'s `POST /auth/login` endpoint, validated via the custom `validateBody` middleware (not NestJS `ValidationPipe`).
- `UnauthorizedError` — framework-agnostic domain error used by `AuthService` to signal invalid credentials, mapped to HTTP 401 by both the NestJS `DomainExceptionFilter` and the Express `errorHandler` middleware.

### 2.3 The Decisive Rule: Where Do New Types Go?

| If the type... | Goes in... | Because... |
|----------------|------------|------------|
| Describes the HTTP request/response wire format | `@repo/contracts` | The frontend needs it without pulling in backend deps |
| Is a DTO with `class-validator` decorators (used by either Express or NestJS) | `@repo/shared/dtos/` | Depends on `class-validator` and optionally `@nestjs/swagger` |
| Is a domain entity, props interface, or repository port | Inside the module's `domain/` folder | Module-specific — not shared |
| Is a reusable base class for multiple microservices | `@repo/shared` | Avoids duplication across services |

---

## 3. Module Anatomy & Hexagonal Architecture — `core_microservice` (NestJS)

> **Note:** This section describes the architecture of `core_microservice`. For `auth_microservice`'s bare Express architecture, see [Section 4](#4-express--manual-di-architecture--auth_microservice).

### 3.1 The Fully-Scaffolded Module: `modules/profiles`

The `profiles` module is the canonical reference implementation. Every new module should mirror its folder structure:

```
modules/profiles/
├── profiles.module.ts                         # NestJS module wiring
├── profiles.controller.ts                     # HTTP entry point
├── profiles.service.ts                        # Application orchestration
│
├── domain/
│   ├── entities/
│   │   ├── user-profile.entity.ts             # Aggregate root (extends TypeormEntityBase)
│   │   ├── user-profile.entity.spec.ts        # Unit tests for domain logic
│   │   └── profile-to-profile-configuration.entity.ts  # Child entity
│   ├── interfaces/
│   │   ├── user-profile.props.ts              # Domain props (pure interface, no TypeORM)
│   │   └── user-profile-repository.port.ts    # Repository port (extends RepositoryPort)
│   └── errors/
│       └── user-profile.errors.ts             # Module-specific domain errors
│
├── dto/
│   ├── create-profile.dto.ts                  # Inbound request DTO
│   └── profile-response.dto.ts                # Outbound response DTO
│
├── infrastructure/
│   └── repository/
│       └── user-profile.repository.ts         # TypeORM adapter (extends TypeormRepositoryBase)
│
└── __tests__/
    └── fakers/
        ├── index.ts
        └── user-profile.faker.ts              # Test data factory
```

### 3.2 The Layers Explained

#### Layer 1: Domain Entities (`domain/entities/`)

Entities are the **heart of the domain**. They extend `TypeormEntityBase` (which provides `id`, `createdAt`, `updatedAt`, `deletedAt`) and encapsulate business rules through methods — never through external validators:

```typescript
// modules/profiles/domain/entities/user-profile.entity.ts

@Entity('user_profiles')
export class UserProfile extends TypeormEntityBase implements UserProfileProps {
  @Index()
  @Column({ type: 'uuid', unique: true })
  authUserId!: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  username!: string;

  @Column({ type: 'varchar', length: DISPLAY_NAME_MAX_LENGTH })
  displayName!: string;

  @Column({ type: 'text', nullable: true })
  bio?: string;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl?: string;

  // Factory: centralizes construction logic (display name defaults to handle)
  static create(props: CreateUserProfileProps): UserProfile {
    const profile = new UserProfile();
    profile.authUserId = props.authUserId;
    profile.username = props.username;
    profile.displayName = props.displayName?.trim() || props.username;
    return profile;
  }

  // Domain method: enforces display name length rule
  rename(displayName: string): void {
    const next = displayName.trim();
    if (next.length === 0 || next.length > DISPLAY_NAME_MAX_LENGTH) {
      throw new InvalidDisplayNameError(displayName);
    }
    this.displayName = next;
  }

  // Domain method: enforces bio length, supports null-to-clear
  editBio(bio: string | null): void {
    if (bio !== null && bio.length > PROFILE_BIO_MAX_LENGTH) {
      throw new InvalidProfileBioError(bio.length);
    }
    this.bio = bio ?? undefined;
  }

  // Domain computed properties
  get hasAvatar(): boolean { return Boolean(this.avatarUrl); }
  get isComplete(): boolean {
    return Boolean(this.displayName) && Boolean(this.bio) && this.hasAvatar;
  }
}
```

**Key principles:**
- Business rules live **inside** the entity, as methods and getters — never in services or controllers.
- Validation failures throw `DomainError` subclasses, which are framework-agnostic and unit-testable.
- A `static create()` factory ensures entities are never constructed in an inconsistent state.
- The entity **directly extends** `TypeormEntityBase` — it is both a domain object and a TypeORM entity. This is a pragmatic choice: separating them into a pure domain model + a separate ORM model would add complexity without benefit at this scale.

The same pattern is used across all domains. For example, `Post` (in `modules/posts`):

```typescript
// modules/posts/domain/entities/post.entity.ts

@Entity('posts')
export class Post extends TypeormEntityBase {
  // ... columns ...

  static create(props: { authorId: string; content: string }): Post {
    const post = new Post();
    post.authorId = props.authorId;
    post.content = props.content;
    post.status = PostStatus.Draft;      // Invariant: new posts are always drafts
    return post;
  }

  publish(): void {
    if (!this.canPublish) {
      throw new InvalidPostStateError(this.status);  // Only drafts can be published
    }
    this.status = PostStatus.Published;
  }

  get canPublish(): boolean {
    return this.status === PostStatus.Draft && this.content.trim().length > 0;
  }
}
```

And `Comment` (in `modules/comments`):

```typescript
// modules/comments/domain/entities/comment.entity.ts

export class EmptyCommentError extends DomainError {
  constructor() { super('Comment content cannot be empty.'); }
}

@Entity('comments')
export class Comment extends TypeormEntityBase {
  // ... columns (postId, authorId, parentId, content) ...

  static create(props: { postId: string; authorId: string; content: string; parentId?: string }): Comment {
    const comment = new Comment();
    comment.postId = props.postId;
    comment.authorId = props.authorId;
    comment.content = props.content;
    comment.parentId = props.parentId;
    return comment;
  }

  edit(content: string): void {
    const next = content.trim();
    if (next.length === 0) throw new EmptyCommentError();
    this.content = next;
  }
}
```

#### Layer 2: Domain Interfaces (`domain/interfaces/`)

Two kinds of interfaces live here:

**a) Props interfaces** — pure data shapes decoupled from TypeORM. These type the repository's query parameters:

```typescript
// modules/profiles/domain/interfaces/user-profile.props.ts
export interface UserProfileProps {
  authUserId: string;
  username: string;
  displayName: string;
  bio?: string;
  avatarUrl?: string;
}
```

**b) Repository ports** — abstractions the service depends on. This is the "port" in "Ports and Adapters":

```typescript
// modules/profiles/domain/interfaces/user-profile-repository.port.ts
import type { RepositoryPort } from '@repo/shared';
import type { UserProfile } from '../../domain/entities/user-profile.entity';
import type { UserProfileProps } from './user-profile.props';

export interface IUserProfileRepository
  extends RepositoryPort<UserProfile, UserProfileProps> {
  // Domain-specific finders beyond the generic RepositoryPort surface
  findByAuthUserId(authUserId: string): Promise<UserProfile | null>;
}

// DI token for injecting by interface rather than concrete class
export const UserProfileRepositoryKey = Symbol.for('IUserProfileRepository');
```

The `RepositoryPort<Entity, EntityProps>` is defined in `@repo/shared` and represents the **complete generic data-access contract** — find, save, delete, paginate, count, exists, upsert, soft-delete:

```typescript
// packages/shared/src/database/repository.port.ts (abridged)
export interface RepositoryPort<Entity, EntityProps>
  extends
    DeleteOne<Entity>, DeleteMultiple<Entity>, DeleteByCriteria<EntityProps>,
    FindMany<Entity, EntityProps>, FindManyPaginated<Entity, EntityProps>,
    FindOne<Entity, EntityProps>, FindOneByIdOrThrow<Entity>,
    FindOneOrThrow<Entity, EntityProps>, Save<Entity>, SaveMultiple<Entity>,
    SoftDelete<Entity>, Count<EntityProps>, Exists<EntityProps>, Upsert<Entity> {}
```

#### Layer 3: Domain Errors (`domain/errors/`)

Module-specific errors that encode domain rule violations:

```typescript
// modules/profiles/domain/errors/user-profile.errors.ts
import { DomainError } from '@repo/shared';

export class InvalidDisplayNameError extends DomainError {
  constructor(value: string) {
    super(`Display name "${value}" is invalid: it must be 1–100 characters.`);
  }
}

export class InvalidProfileBioError extends DomainError {
  constructor(length: number) {
    super(`Profile bio is too long: ${length} characters (max 160).`);
  }
}
```

All domain errors extend the shared `DomainError` abstract class:

```typescript
// packages/shared/src/errors/domain.error.ts
export abstract class DomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
```

The `DomainExceptionFilter` (registered globally in `main.ts`) catches all `DomainError` subclasses and maps them to appropriate HTTP status codes:

| Error class | HTTP status |
|-------------|-------------|
| `EntityByIdNotFoundError` | 404 Not Found |
| `EntityNotFoundError` | 404 Not Found |
| `UniqueConstraintViolationError` | 409 Conflict |
| `UnauthorizedError` | 401 Unauthorized |
| `DatabaseQueryError` | 500 Internal Server Error |
| Any other `DomainError` subclass (e.g. `InvalidDisplayNameError`) | 400 Bad Request |

This means entities can throw business errors without knowing anything about HTTP.

#### Layer 4: DTOs (`dto/`)

**Inbound DTOs** carry validation decorators and can optionally implement a `@repo/contracts` interface:

```typescript
// modules/profiles/dto/create-profile.dto.ts
export class CreateProfileDto implements ICreateProfileRequest {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  authUserId!: string;

  @ApiProperty({ example: 'john_doe' })
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  handle!: string;
}
```

**Note:** Some DTOs that are shared across microservices live in `@repo/shared/dtos/` (e.g. `CreatePostDto`, `UpdateProfileDto`, `LoginDto`, `CreateUserDto`). Module-specific DTOs that are tightly coupled to one module live inside the module's `dto/` folder (e.g. `CreateProfileDto`).

**Outbound DTOs** (response DTOs) are constructed from entities. They are the translation layer between the domain and the wire:

```typescript
// modules/profiles/dto/profile-response.dto.ts
export class ProfileResponseDto implements IProfileResponse {
  @ApiProperty() id: string;
  @ApiProperty() authUserId: string;
  @ApiProperty() username: string;
  @ApiProperty() displayName: string;
  @ApiProperty({ type: String, nullable: true }) bio: string | null;
  @ApiProperty({ type: String, nullable: true }) avatarUrl: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;

  constructor(profile: UserProfile) {
    this.id = profile.id;
    this.authUserId = profile.authUserId;
    this.username = profile.username;
    this.displayName = profile.displayName;
    this.bio = profile.bio ?? null;         // normalize undefined → null
    this.avatarUrl = profile.avatarUrl ?? null;
    this.createdAt = profile.createdAt.toISOString();   // Date → ISO string
    this.updatedAt = profile.updatedAt.toISOString();
  }
}
```

The post response DTO follows the exact same pattern:

```typescript
// modules/posts/dto/post-response.dto.ts
export class PostResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() authorId: string;
  @ApiProperty() content: string;
  @ApiProperty({ enum: PostStatus }) status: PostStatus;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;

  constructor(post: Post) {
    this.id = post.id;
    this.authorId = post.authorId;
    this.content = post.content;
    this.status = post.status;
    this.createdAt = post.createdAt.toISOString();
    this.updatedAt = post.updatedAt.toISOString();
  }
}
```

#### Layer 5: Infrastructure — Repository Adapter (`infrastructure/repository/`)

This is the "adapter" in "Ports and Adapters." It extends `TypeormRepositoryBase` from `@repo/shared`:

```typescript
// modules/profiles/infrastructure/repository/user-profile.repository.ts
@Injectable()
export class UserProfileRepository
  extends TypeormRepositoryBase<UserProfile, UserProfileProps>
  implements IUserProfileRepository
{
  public static readonly entity = UserProfile;
  protected relations: string[] = [];   // no default joined relations

  constructor(@InjectRepository(UserProfile) repository: Repository<UserProfile>) {
    super(repository);
  }

  // Domain-specific finder
  public async findByAuthUserId(authUserId: string): Promise<UserProfile | null> {
    return this.repository.findOne({ where: { authUserId } });
  }
}
```

By extending `TypeormRepositoryBase`, the concrete repository **inherits the full data-access surface** (save, findOneByIdOrThrow, findManyPaginated, softDelete, upsert, etc.) without writing a single line of repetitive code. The base class handles:

- Converting string-array relations to TypeORM's nested object format
- Logging every persistence operation
- Catching TypeORM `QueryFailedError` and translating unique violations into `UniqueConstraintViolationError`
- Implementing `findOneByIdOrThrow` / `findOneOrThrow` with proper `EntityByIdNotFoundError` / `EntityNotFoundError` throws

The post repository demonstrates a repository with default relations:

```typescript
// modules/posts/infrastructure/repository/post.repository.ts
@Injectable()
export class PostRepository extends TypeormRepositoryBase<Post, PostProps> {
  public static readonly entity = Post;
  protected relations: string[] = ['author'];  // author profile joined on every read

  constructor(@InjectRepository(Post) repository: Repository<Post>) {
    super(repository);
  }
}
```

The comment repository adds a domain-specific finder:

```typescript
// modules/comments/infrastructure/repository/comment.repository.ts
@Injectable()
export class CommentRepository extends TypeormRepositoryBase<Comment, CommentProps> {
  public static readonly entity = Comment;
  protected relations: string[] = ['author'];

  constructor(@InjectRepository(Comment) repository: Repository<Comment>) {
    super(repository);
  }

  async findByPost(postId: string): Promise<Comment[]> {
    return this.repository.find({
      where: { postId },
      relations: { author: true },
      order: { createdAt: 'DESC' },
    });
  }
}
```

#### Layer 6: Service (`profiles.service.ts`)

The service orchestrates the domain — it does not contain business rules. It fetches entities, calls their domain methods, and persists:

```typescript
// modules/profiles/profiles.service.ts
@Injectable()
export class ProfilesService {
  constructor(private readonly userProfileRepository: UserProfileRepository) {}

  async createProfile(authUserId: string, handle: string): Promise<UserProfile> {
    // Entity factory knows how to build a valid profile
    const profile = UserProfile.create({ authUserId, username: handle });
    return this.userProfileRepository.save(profile);
  }

  async getProfile(id: string): Promise<UserProfile> {
    return this.userProfileRepository.findOneByIdOrThrow(id);
    // ↑ throws EntityByIdNotFoundError (→ 404 via DomainExceptionFilter)
  }

  async updateProfile(id: string, updateDto: UpdateProfileDto): Promise<UserProfile> {
    const profile = await this.getProfile(id);
    // Mutations go through entity domain methods — not raw property assignment
    if (updateDto.bio !== undefined) {
      profile.editBio(updateDto.bio ?? null);  // throws InvalidProfileBioError if too long
    }
    return this.userProfileRepository.save(profile);
  }
}
```

#### Layer 7: Controller (`profiles.controller.ts`)

The controller is a thin translation layer: validate input → call service → map entity to response DTO:

```typescript
// modules/profiles/profiles.controller.ts
@ApiTags('Profiles')
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Post()
  async createProfile(@Body() createProfileDto: CreateProfileDto): Promise<ProfileResponseDto> {
    const profile = await this.profilesService.createProfile(
      createProfileDto.authUserId,
      createProfileDto.handle,
    );
    return new ProfileResponseDto(profile);  // entity → wire format
  }

  @Get(':id')
  async getProfile(@Param('id', ParseUUIDPipe) id: string): Promise<ProfileResponseDto> {
    return new ProfileResponseDto(await this.profilesService.getProfile(id));
  }

  @Patch(':id')
  async updateProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    const profile = await this.profilesService.updateProfile(id, updateProfileDto);
    return new ProfileResponseDto(profile);
  }
}
```

#### Layer 8: Module (`profiles.module.ts`)

The module wires everything together via NestJS DI:

```typescript
// modules/profiles/profiles.module.ts
@Module({
  imports: [TypeOrmModule.forFeature([UserProfile, ProfileToProfileConfiguration])],
  controllers: [ProfilesController],
  providers: [ProfilesService, UserProfileRepository],
})
export class ProfilesModule {}
```

---

## 4. Express & Manual DI Architecture — `auth_microservice`

> **Note:** This section describes the architecture of `auth_microservice`, which was migrated from NestJS to bare Express.js and then refactored to follow the same Ports & Adapters (Hexagonal Architecture) pattern as `core_microservice`. For `core_microservice`'s NestJS Hexagonal Architecture, see [Section 3](#3-module-anatomy--hexagonal-architecture--core_microservice-nestjs).

### 4.1 Folder Structure

```
apps/auth_microservice/src/
├── main.ts                              # Composition Root (bootstrap, graceful shutdown)
├── app.ts                               # App Factory (Express app creation, manual DI wiring)
│
├── config/
│   ├── env.ts                           # Centralized environment config with fail-fast validation
│   ├── database.ts                      # DataSource factory (TypeORM)
│   ├── redis.ts                         # Redis client factory (ioredis)
│   ├── jwt.ts                           # JWT configuration (delegates to env.ts)
│   ├── google.ts                        # Google OAuth client configuration
│   └── swagger.ts                       # Swagger/OpenAPI setup (swagger-jsdoc + swagger-ui-express)
│
├── domain/
│   ├── entities/
│   │   └── auth-user.entity.ts          # Extends TypeormEntityBase (passwordHash nullable, googleId added)
│   └── interfaces/                      # Port interfaces (contracts the domain depends on)
│       ├── auth-user-repository.interface.ts  # IAuthUserRepository extends RepositoryPort
│       ├── cache.service.ts             # ICacheService (port for Redis caching)
│       ├── crypto.service.interface.ts  # ICryptoService (port for password hashing/comparison)
│       ├── jwt.service.interface.ts     # IJwtService + JwtPayload (port for JWT operations)
│       └── oauth.service.interface.ts   # IOAuthService + IOAuthPayload (port for OAuth verification)
│
├── infrastructure/                      # Adapters implementing domain port interfaces
│   ├── repositories/
│   │   └── auth-user.repository.ts      # Implements IAuthUserRepository, extends TypeormRepositoryBase
│   ├── cache/
│   │   └── redis.service.ts             # Implements ICacheService (wraps ioredis)
│   ├── jwt/
│   │   └── jwt.service.ts              # Implements IJwtService (wraps jsonwebtoken)
│   ├── crypto/
│   │   └── crypto.service.ts            # BcryptService implements ICryptoService (wraps bcrypt)
│   └── oauth/
│       └── google-oauth.service.ts      # GoogleOAuthService implements IOAuthService (wraps google-auth-library)
│
├── services/
│   ├── auth.service.ts                  # Login, Google OAuth, token refresh/logout, JWT verification
│   └── users.service.ts                 # User registration, lookup, Google account linking
│
├── routes/
│   ├── auth.routes.ts                   # POST /auth/login, /auth/google, /auth/refresh, /auth/logout; GET /auth/me
│   └── users.routes.ts                  # POST /users/register, GET /users/:id
│
├── middleware/
│   ├── auth.middleware.ts               # requireAuth() — JWT verification middleware factory
│   ├── validate.middleware.ts           # validateBody<T>(DtoClass) — class-validator-based validation
│   └── error-handler.middleware.ts      # DomainError → HTTP status code mapping
│
├── types/
│   └── express.d.ts                     # Global Express Request augmentation (req.user: JwtPayload)
│
└── migrations/
    ├── 1782126100129-InitialAuthSchema.ts
    └── 1785236513612-AddGoogleOAuthToUsers.ts
```

### 4.2 Architecture Overview

The `auth_microservice` follows the **Ports & Adapters (Hexagonal Architecture)** pattern with **manual Dependency Injection**. The structure mirrors `core_microservice`'s layering: domain ports in `domain/interfaces/`, adapter implementations in `infrastructure/`, entities in `domain/entities/`, and application services in `services/`.

The architecture has five distinct layers of responsibility:

```
┌──────────────────────────────────────────────────────┐
│  main.ts — Composition Root                          │
│  • Imports reflect-metadata                          │
│  • Loads env.ts (centralized config with fail-fast)  │
│  • Initializes DB (TypeORM DataSource)               │
│  • Initializes Redis (ioredis → RedisService)        │
│  • Creates WinstonLogger                             │
│  • Calls app factory: createApp(dataSource, logger,  │
│    redisService)                                     │
│  • Registers SIGINT/SIGTERM for Graceful Shutdown    │
└────────────┬─────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────┐
│  app.ts — App Factory / Composition Root (cont.)     │
│  • Creates Express Application                       │
│  • Registers global middleware (cors, json parser)   │
│  • Constructs infrastructure adapters:               │
│    new BcryptService(env.crypto.saltRounds)           │
│    new AuthUserRepository(dataSource)                 │
│    new JwtService()                                   │
│    new GoogleOAuthService()                           │
│  • Constructs services with port interfaces injected:│
│    new UsersService(authUserRepository, logger,       │
│                     cryptoService)                    │
│    new AuthService(usersService, redisService,        │
│                    logger, cryptoService,              │
│                    jwtService, oauthService)           │
│  • Mounts routers by injecting services into factory:│
│    app.use('/users', createUsersRouter(usersService)) │
│    app.use('/auth', createAuthRouter(authService))    │
│  • Registers error handler middleware                │
│  • Sets up Swagger                                   │
└────────────┬─────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────┐
│  routes/*.ts — Router Factories                      │
│  • createAuthRouter(authService) → Router             │
│  • createUsersRouter(usersService) → Router           │
│  • Each route:                                       │
│    1. validateBody(DtoClass) middleware               │
│    2. Async handler → calls service                   │
│    3. Sends JSON response                            │
│    4. Forwards errors via next(error)                 │
└────────────┬─────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────┐
│  services/*.ts — Application Services                │
│  • Plain classes (no decorators)                     │
│  • Depend on port interfaces, not concrete adapters  │
│  • UsersService: IAuthUserRepository, ICryptoService │
│  • AuthService: ICacheService, ICryptoService,        │
│    IJwtService, IOAuthService                        │
│  • Orchestrate domain logic + persistence            │
└────────────┬─────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────┐
│  infrastructure/*.ts — Adapters (Port Implementations)│
│  • AuthUserRepository: TypeormRepositoryBase adapter  │
│  • RedisService: ICacheService adapter (ioredis)     │
│  • JwtService: IJwtService adapter (jsonwebtoken)    │
│  • BcryptService: ICryptoService adapter (bcrypt)    │
│  • GoogleOAuthService: IOAuthService adapter          │
│    (google-auth-library)                              │
│  • All implement domain port interfaces              │
└──────────────────────────────────────────────────────┘
```

**Key design principle:** Services depend on **port interfaces** (abstractions defined in `domain/interfaces/`), never on concrete adapters. This means:
- `UsersService` depends on `IAuthUserRepository`, not `AuthUserRepository`
- `AuthService` depends on `ICacheService`, not `RedisService`
- `AuthService` depends on `ICryptoService`, not `BcryptService`
- `AuthService` depends on `IJwtService`, not JWT library directly
- `AuthService` depends on `IOAuthService`, not `google-auth-library` directly

This makes services unit-testable — ports can be mocked, and adapter implementations can be swapped (e.g., in-memory cache for tests, Redis for production).

### 4.3 Composition Root (`main.ts`)

The composition root is the single place where the application's dependency graph is assembled. It is the entry point for the process:

```typescript
// apps/auth_microservice/src/main.ts
import 'reflect-metadata';
import { env } from './config/env';

import { WinstonLogger } from '@repo/shared';
import { initDatabase } from './config/database';
import { createApp } from './app';
import { createRedisClient } from './config/redis';
import { RedisService } from './infrastructure/cache/redis.service';

async function bootstrap() {
  const logger = new WinstonLogger('AuthMicroservice');

  try {
    // 1. Initialize database (TypeORM DataSource)
    const dataSource = await initDatabase();
    logger.debug('Database connected successfully');

    const redisClient = createRedisClient();
    const redisService = new RedisService(redisClient, logger);

    // 2. Initialize Express app with injected dependencies
    const app = createApp(dataSource, logger, redisService);
    const port = env.app.port;

    // 3. Start server
    const server = app.listen(port, () => {
      logger.info(`Auth Microservice is running on port ${port}`);
    });

    // Graceful Shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully...`);
      server.close();
      try {
        await redisClient.quit();
        logger.debug('Redis disconnected');
      } catch (err) {
        logger.error('Error disconnecting Redis', { error: err });
      }
      try {
        await dataSource.destroy();
        logger.debug('Database disconnected');
      } catch (err) {
        logger.error('Error disconnecting database', { error: err });
      }
      logger.info('Graceful shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    logger.error('Failed to start Auth Microservice', { error });
    process.exit(1);
  }
}

bootstrap();
```

**Key responsibilities:**

- **`import 'reflect-metadata'`** — Must be the first import. Required by TypeORM for entity decorator metadata and by `class-transformer` (used in `validateBody` middleware).
- **`env.ts` centralized config** — Environment variables are loaded and validated once via `config/env.ts` (fail-fast validation), eliminating scattered `process.env` reads and `dotenv.config` calls in `main.ts`. The `env` object provides typed, validated configuration for `app`, `db`, `redis`, `jwt`, `google`, and `crypto`.
- **Infrastructure initialization** — Database (`DataSource`), Redis (`ioredis` → wrapped in `RedisService`), and logger (`WinstonLogger`) are constructed before the Express app exists.
- **App factory call** — Passes the infrastructure dependencies into `createApp()`, which wires them into services.
- **Graceful Shutdown** — Listens for `SIGINT` (Ctrl+C) and `SIGTERM` (Docker stop). Closes the HTTP server first, then disconnects Redis, then destroys the TypeORM `DataSource`. Ensures no in-flight requests are dropped abruptly.

### 4.4 App Factory (`app.ts`)

The app factory is a pure function that creates and configures the Express application. This is the central wiring point for manual DI — where **port interfaces are bound to their adapter implementations**:

```typescript
// apps/auth_microservice/src/app.ts
import express, { Application } from 'express';
import cors from 'cors';
import { DataSource } from 'typeorm';
import type { WinstonLogger } from '@repo/shared';
import { BcryptService } from './infrastructure/crypto/crypto.service';
import { AuthUserRepository } from './infrastructure/repositories/auth-user.repository';
import { JwtService } from './infrastructure/jwt/jwt.service';
import { GoogleOAuthService } from './infrastructure/oauth/google-oauth.service';

import { createUsersRouter } from './routes/users.routes';
import { createAuthRouter } from './routes/auth.routes';
import { errorHandler } from './middleware/error-handler.middleware';
import { UsersService } from './services/users.service';
import { AuthService } from './services/auth.service';
import { setupSwagger } from './config/swagger';
import { RedisService } from './infrastructure/cache/redis.service';
import { env } from './config/env';

export function createApp(
  dataSource: DataSource,
  logger: WinstonLogger,
  redisService: RedisService,
): Application {
  const app = express();

  // Global middleware
  app.use(cors());
  app.use(express.json());

  setupSwagger(app);

  // Infrastructure adapters (implement domain ports)
  const cryptoService = new BcryptService(env.crypto.saltRounds);
  const authUserRepository = new AuthUserRepository(dataSource);
  const jwtService = new JwtService();
  const oauthService = new GoogleOAuthService();

  // Application services (depend on port interfaces, not concrete adapters)
  const usersService = new UsersService(authUserRepository, logger, cryptoService);
  const authService = new AuthService(
    usersService,
    redisService,
    logger,
    cryptoService,
    jwtService,
    oauthService,
  );

  // Mount routers by injecting services into router factories
  app.use('/users', createUsersRouter(usersService));
  app.use('/auth', createAuthRouter(authService));

  // Global error handler (must be registered last)
  app.use(errorHandler);

  return app;
}
```

**Key design decisions:**

- **`createApp` is a factory function, not a class.** There is no need for an `AppModule` or a NestJS bootstrap. The function takes infrastructure dependencies, creates the Express app, and returns it.
- **Adapters are constructed first**, then injected into services that depend on port interfaces:
  - `UsersService` depends on `IAuthUserRepository` — receives `AuthUserRepository`
  - `UsersService` depends on `ICryptoService` — receives `BcryptService`
  - `AuthService` depends on `ICacheService` — receives `RedisService`
  - `AuthService` depends on `ICryptoService` — receives `BcryptService`
  - `AuthService` depends on `IJwtService` — receives `JwtService`
  - `AuthService` depends on `IOAuthService` — receives `GoogleOAuthService`
- **Routers are factory functions** (`createUsersRouter(usersService)`), not classes. They receive their dependency (the service) via closure and return an Express `Router`.
- **`env` import** — The centralized `env.ts` provides typed configuration (e.g., `env.crypto.saltRounds`) instead of scattered `process.env` reads.

### 4.5 Routing & Validation

#### Router Factories

Instead of NestJS `@Controller` and `@Get`/`@Post` decorators, routes are defined using Express `Router` factory functions:

```typescript
// apps/auth_microservice/src/routes/auth.routes.ts
import { Router } from 'express';
import { AuthService } from '../services/auth.service';
import { validateBody } from '../middleware/validate.middleware';
import { GoogleLoginDto, LoginDto, RefreshTokenDto } from '@repo/shared';
import { requireAuth } from '../middleware/auth.middleware';

export function createAuthRouter(authService: AuthService): Router {
  const router = Router();

  /**
   * @openapi
   * /auth/login:
   *   post:
   *     summary: Authenticate user using email and password
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [email, password]
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *               password:
   *                 type: string
   *                 minLength: 8
   *     responses:
   *       200:
   *         description: Login successful
   *       400:
   *         description: Bad Request (validation errors)
   *       401:
   *         description: Invalid credentials
   */
  router.post('/login', validateBody(LoginDto), async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const result = await authService.login(email, password);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /auth/google:
   *   post:
   *     summary: Authenticate or register user using Google ID Token
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [idToken]
   *             properties:
   *               idToken:
   *                 type: string
   *                 description: The JWT ID token issued by Google
   *     responses:
   *       200:
   *         description: Login successful
   *       400:
   *         description: Bad Request (missing token)
   *       401:
   *         description: Invalid or expired Google token
   */
  router.post('/google', validateBody(GoogleLoginDto), async (req, res, next) => {
    try {
      const { idToken } = req.body;
      const result = await authService.loginWithGoogle(idToken);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /auth/refresh:
   *   post:
   *     summary: Refresh access token
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/RefreshTokenDto'
   *     responses:
   *       200:
   *         description: New tokens generated
   *       401:
   *         description: Invalid or expired refresh token
   */
  router.post('/refresh', validateBody(RefreshTokenDto), async (req, res, next) => {
    try {
      const { refreshToken } = req.body;
      const result = await authService.refreshToken(refreshToken);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /auth/logout:
   *   post:
   *     summary: Logout user and invalidate refresh token
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/RefreshTokenDto'
   *     responses:
   *       200:
   *         description: Logged out successfully
   */
  router.post('/logout', validateBody(RefreshTokenDto), async (req, res, next) => {
    try {
      const { refreshToken } = req.body;
      await authService.logout(refreshToken);
      res.status(200).json({ message: 'Logged out successfully' });
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /auth/me:
   *   get:
   *     summary: Get current authenticated user's JWT payload
   *     tags: [Auth]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Returns the user payload extracted from JWT
   *       401:
   *         description: Unauthorized (missing or invalid token)
   */
  router.get('/me', requireAuth(authService), (req, res) => {
    res.status(200).json({
      statusCode: 200,
      user: req.user,
    });
  });

  return router;
}
```

```typescript
// apps/auth_microservice/src/routes/users.routes.ts
import { Router } from 'express';
import { UsersService } from '../services/users.service';
import { validateBody } from '../middleware/validate.middleware';
import { CreateUserDto } from '@repo/shared';

export function createUsersRouter(usersService: UsersService): Router {
  const router = Router();

  /**
   * @openapi
   * /users/register:
   *   post:
   *     summary: Register a new user
   *     tags: [Users]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               email:
   *                 type: string
   *               password:
   *                 type: string
   *     responses:
   *       201:
   *         description: User created successfully
   *       409:
   *         description: Email already in use
   */
  router.post('/register', validateBody(CreateUserDto), async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const result = await usersService.registerUser(email, password);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const result = await usersService.getUserById(req.params.id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
```

**Key patterns:**

- The service is injected into the factory function via **closure**, not via an IoC container.
- Every async handler wraps its body in `try/catch` and forwards errors via `next(error)` to the global `errorHandler` middleware.
- Route handlers are plain Express `(req, res, next)` callbacks — no parameter decorators, no `@Body()`, no `@Param()`.
- **DTOs are destructured** in route handlers (`const { email, password } = req.body`) before passing primitive values to services — services receive typed primitives, not raw DTOs. This keeps services decoupled from HTTP concerns.
- **Swagger docs** are inlined as JSDoc `@openapi` comments (rendered by `swagger-jsdoc`) — this replaces NestJS `@ApiTags()`/`@ApiProperty()` decorators.
- **Auth middleware**: `GET /auth/me` is protected by `requireAuth(authService)`, a factory middleware that extracts the Bearer token, calls `authService.verifyToken()`, and attaches the decoded `JwtPayload` to `req.user`. Express's `Request` type is globally augmented in `types/express.d.ts` to include `user?: JwtPayload`.

#### Custom `validateBody` Middleware

Instead of NestJS's global `ValidationPipe`, we use a custom middleware built on the same underlying libraries (`class-transformer` + `class-validator`):

```typescript
// apps/auth_microservice/src/middleware/validate.middleware.ts
import { NextFunction, Request, Response } from 'express';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

export function validateBody<T extends object>(dtoClass: new () => T) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const dtoInstance = plainToInstance(dtoClass, req.body);

    const errors = await validate(dtoInstance);

    if (errors.length > 0) {
      const messages = errors
        .map((err) => Object.values(err.constraints || {}))
        .flat();
      res.status(400).json({
        statusCode: 400,
        error: 'Bad Request',
        message: messages,
      });
      return;
    }

    req.body = dtoInstance;  // Replace raw JSON with transformed, validated instance
    next();
  };
}
```

**Comparison with NestJS `ValidationPipe`:**

| Feature | NestJS `ValidationPipe` | Express `validateBody` |
|---|---|---|
| Underlying libraries | `class-transformer` + `class-validator` | `class-transformer` + `class-validator` (same) |
| Registration | Global: `app.useGlobalPipes(new ValidationPipe(...))` | Per-route: `router.post('/x', validateBody(Dto), handler)` |
| Whitelisting (`whitelist: true`) | Built-in | Not implemented (strips nothing) |
| Transformation (`transform: true`) | Built-in | `req.body` is replaced with the transformed instance |
| Error format | NestJS `BadRequestException` JSON | Custom `{ statusCode: 400, error: 'Bad Request', message: [...] }` |

The trade-off: `validateBody` is simpler but less featureful than `ValidationPipe`. For `auth_microservice`'s narrow DTO surface, this is sufficient. If whitelisting or nested object validation becomes necessary, those features can be added incrementally.

#### Error Handler Middleware

The global error handler translates framework-agnostic `DomainError` subclasses into HTTP status codes — the same mapping used by `DomainExceptionFilter` in NestJS:

```typescript
// apps/auth_microservice/src/middleware/error-handler.middleware.ts
import {
  DomainError,
  EntityNotFoundError,
  UniqueConstraintViolationError,
  DatabaseQueryError,
  UnauthorizedError,
} from '@repo/shared';
import { NextFunction, Request, Response } from 'express';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction): void {
  if (!(err instanceof DomainError)) {
    console.error('Unhandled Server Error:', err);
    res.status(500).json({ statusCode: 500, message: 'Internal Server Error' });
    return;
  }

  let status = 400;
  if (err instanceof EntityNotFoundError) status = 404;
  else if (err instanceof UniqueConstraintViolationError) status = 409;
  else if (err instanceof DatabaseQueryError) status = 500;
  else if (err instanceof UnauthorizedError) status = 401;

  res.status(status).json({
    statusCode: status,
    error: err.name,
    message: err.message,
  });
}
```

| DomainError subclass | HTTP status | Example trigger |
|---|---|---|
| `EntityNotFoundError` | 404 | `GET /users/:id` with unknown id |
| `UniqueConstraintViolationError` | 409 | `POST /users/register` with duplicate email |
| `UnauthorizedError` | 401 | `POST /auth/login` with wrong password |
| `DatabaseQueryError` | 500 | Unexpected database failure |
| Any other `DomainError` | 400 | Default fallback |

### 4.6 Services

Services are plain TypeScript classes — no `@Injectable()`, no decorators, no NestJS DI tokens. Dependencies are received through the constructor, passed explicitly by the app factory. **Crucially, services depend on port interfaces (abstractions), not concrete adapters.**

#### `UsersService`

Handles user registration, lookup, password hashing, and Google account linking. Depends on `IAuthUserRepository` (port) and `ICryptoService` (port) — not on `DataSource` or `bcrypt` directly:

```typescript
// apps/auth_microservice/src/services/users.service.ts
import type { WinstonLogger } from '@repo/shared';
import { UniqueConstraintViolationError } from '@repo/shared';
import { ICryptoService } from '../domain/interfaces/crypto.service.interface';
import { AuthUser } from '../domain/entities/auth-user.entity';
import { IAuthUserRepository } from '../domain/interfaces/auth-user-repository.interface';

export class UsersService {
  constructor(
    private readonly userRepository: IAuthUserRepository,
    private readonly logger: WinstonLogger,
    private readonly cryptoService: ICryptoService,
  ) {}

  async registerUser(
    email: string,
    password: string,
  ): Promise<Omit<AuthUser, 'passwordHash'>> {
    const existing = await this.userRepository.findByEmail(email);
    if (existing) {
      throw new UniqueConstraintViolationError(
        'User with this email already exists',
        email,
      );
    }

    const passwordHash = await this.cryptoService.hash(password);

    const user = new AuthUser();
    user.email = email;
    user.passwordHash = passwordHash;
    user.isEmailVerified = false;

    const savedUser = await this.userRepository.save(user);
    this.logger.debug('User registered', { props: { userId: savedUser.id } });

    const { passwordHash: _, ...safeUser } = savedUser;
    return safeUser;
  }

  async getUserById(id: string): Promise<Omit<AuthUser, 'passwordHash'>> {
    const user = await this.userRepository.findOneByIdOrThrow(id);
    const { passwordHash: _, ...safeUser } = user;
    return safeUser;
  }

  async findByEmailWithPassword(email: string): Promise<AuthUser | null> {
    return this.userRepository.findByEmail(email);
  }

  async findOrCreateByGoogle(email: string, googleId: string): Promise<AuthUser> {
    let user = await this.userRepository.findByEmail(email);

    if (user) {
      // Link Google account to existing email user
      if (!user.googleId) {
        user.googleId = googleId;
        user.isEmailVerified = true;
        user = await this.userRepository.save(user);
        this.logger.debug('Linked Google account to existing user', {
          props: { userId: user.id },
        });
      }
      return user;
    }

    // Create new Google-authenticated user (no password)
    const newUser = new AuthUser();
    newUser.email = email;
    newUser.googleId = googleId;
    newUser.isEmailVerified = true;

    const savedUser = await this.userRepository.save(newUser);
    this.logger.debug('Created new user via Google login', {
      props: { userId: savedUser.id },
    });
    return savedUser;
  }
}
```

**Key changes from the previous design:**
- **`IAuthUserRepository` instead of raw `DataSource`** — The `UsersService` no longer calls `dataSource.getRepository(AuthUser)`. Instead, it depends on the `IAuthUserRepository` port interface, which is implemented by `AuthUserRepository` (extending `TypeormRepositoryBase`). This brings `auth_microservice` in line with `core_microservice`'s repository pattern and makes the service unit-testable with a mock repository.
- **`ICryptoService` instead of direct `bcrypt`** — Password hashing and comparison are delegated to the `ICryptoService` port (implemented by `BcryptService`), not called directly via `bcrypt.hash()`.
- **`findOrCreateByGoogle()`** — New method for Google OAuth flow: finds an existing user by email and links the `googleId`, or creates a new user without a password.

#### `AuthService`

Handles login, Google OAuth, token refresh, logout, and JWT verification. Depends on four port interfaces: `ICacheService`, `ICryptoService`, `IJwtService`, `IOAuthService`:

```typescript
// apps/auth_microservice/src/services/auth.service.ts
import { ICryptoService } from '../domain/interfaces/crypto.service.interface';
import { UnauthorizedError, WinstonLogger } from '@repo/shared';
import { UsersService } from './users.service';
import { AuthUser } from '../domain/entities/auth-user.entity';
import { ICacheService } from '../domain/interfaces/cache.service';
import { IJwtService, JwtPayload } from '../domain/interfaces/jwt.service.interface';
import { env } from '../config/env';
import { IOAuthService } from '../domain/interfaces/oauth.service.interface';

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: Omit<AuthUser, 'passwordHash'>;
}

export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly cacheService: ICacheService,
    private readonly logger: WinstonLogger,
    private readonly cryptoService: ICryptoService,
    private readonly jwtService: IJwtService,
    private readonly oauthService: IOAuthService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.usersService.findByEmailWithPassword(email);

    if (!user || !user.passwordHash) {
      this.logger.debug('Login failed: user not found', { props: { email } });
      throw new UnauthorizedError('Invalid email or password');
    }

    const isValid = await this.cryptoService.compare(password, user.passwordHash);
    if (!isValid) {
      this.logger.debug('Login failed: invalid password', { props: { userId: user.id } });
      throw new UnauthorizedError('Invalid email or password');
    }

    this.logger.debug('User logged in', { props: { userId: user.id } });
    return this.generateTokensAndSession(user);
  }

  async loginWithGoogle(idToken: string): Promise<LoginResult> {
    try {
      const payload = await this.oauthService.verifyIdToken(idToken);

      const user = await this.usersService.findOrCreateByGoogle(
        payload.email,
        payload.sub,
      );

      this.logger.debug('User logged in with Google', { props: { userId: user.id } });
      return this.generateTokensAndSession(user);
    } catch (error) {
      this.logger.error('Google OAuth verification failed', { error });
      throw new UnauthorizedError('Invalid Google token');
    }
  }

  async verifyToken(token: string): Promise<JwtPayload> {
    try {
      return this.jwtService.verifyAccessToken(token);
    } catch (error) {
      throw new UnauthorizedError('Invalid or expired access token');
    }
  }

  async refreshToken(oldRefreshToken: string): Promise<LoginResult> {
    const redisKey = `refresh_token:${oldRefreshToken}`;
    const userId = await this.cacheService.get(redisKey);

    if (!userId) {
      this.logger.debug('Refresh token failed: token not found or expired in Redis');
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    const user = await this.usersService.getUserById(userId);

    // Rotate: delete old token, issue new pair
    await this.cacheService.delete(redisKey);
    return this.generateTokensAndSession(user as AuthUser);
  }

  async logout(refreshToken: string): Promise<void> {
    const redisKey = `refresh_token:${refreshToken}`;
    const deletedCount = await this.cacheService.delete(redisKey);

    if (deletedCount > 0) {
      this.logger.debug('User logged out successfully, refresh token removed');
    }
  }

  private async generateTokensAndSession(user: AuthUser): Promise<LoginResult> {
    const accessToken = this.jwtService.signAccessToken({
      sub: user.id,
      email: user.email,
    });

    const refreshToken = this.jwtService.generateRefreshToken();
    const refreshTtlSeconds = this.jwtService.parseExpiryToSeconds(
      env.jwt.refreshTokenExpiry,
    );

    const redisKey = `refresh_token:${refreshToken}`;
    await this.cacheService.setWithExpiry(redisKey, String(user.id), refreshTtlSeconds);

    const { passwordHash: _, ...safeUser } = user;
    return { accessToken, refreshToken, user: safeUser };
  }
}
```

**Security design:**

- **Passwords** are hashed via `ICryptoService.hash()` (bcrypt, cost factor from `env.crypto.saltRounds`) — the raw password is never stored or logged.
- **`passwordHash` is nullable** — Google-authenticated users have no password (`passwordHash` is `undefined`). The `login` method checks `!user.passwordHash` and rejects passwordless users with a vague error.
- **`passwordHash` is stripped** from the returned `AuthUser` object using destructuring (`const { passwordHash: _, ...safeUser } = user`) — both in `UsersService` and `AuthService`.
- **Tokens flow through port interfaces**: JWT signing/verification delegates to `IJwtService`; Google OAuth verification delegates to `IOAuthService`; refresh token storage delegates to `ICacheService`. `AuthService` contains no direct imports of `jsonwebtoken`, `google-auth-library`, or `ioredis`.
- **Access tokens** are signed JWTs with short expiry (`env.jwt.accessTokenExpiry`).
- **Refresh token rotation**: `refreshToken()` validates the old refresh token against Redis, then **deletes it and issues a new pair** — this limits the window for stolen refresh tokens.
- **Logout** removes the refresh token from Redis, making it unusable immediately.
- **Login error messages** are intentionally vague (`"Invalid email or password"`) — never distinguish between "user not found" and "wrong password" to prevent email enumeration.
- **Token generation is extracted** to a private `generateTokensAndSession()` method shared by `login()`, `loginWithGoogle()`, and `refreshToken()`, eliminating code duplication.

#### `RedisService` (infrastructure adapter)

A thin wrapper around `ioredis` with logging and a cache-aside helper. Now located in `infrastructure/cache/` and implements the `ICacheService` port interface:

```typescript
// apps/auth_microservice/src/infrastructure/cache/redis.service.ts
import { WinstonLogger } from '@repo/shared';
import { Redis } from 'ioredis';
import { ICacheService } from '../../domain/interfaces/cache.service';

export class RedisService implements ICacheService {
  constructor(
    private readonly client: Redis,
    private readonly logger: WinstonLogger,
  ) {
    this.registerEventHandlers();
  }

  private registerEventHandlers(): void {
    this.client.on('connect', () => this.logger.info('Redis connected'));
    this.client.on('error', (err: Error) =>
      this.logger.error('Redis error', { error: err }),
    );
    this.client.on('reconnecting', () =>
      this.logger.warn('Redis reconnecting...'),
    );
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async setWithExpiry(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async delete(key: string): Promise<number> {
    return this.client.del(key);
  }

  async has(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  async getOrSet(
    key: string,
    factory: () => Promise<string>,
    ttlSeconds: number,
  ): Promise<string> {
    const cached = await this.client.get(key);
    if (cached !== null) {
      return cached;
    }
    const value = await factory();
    await this.client.set(key, value, 'EX', ttlSeconds);
    return value;
  }
}
```

The `getOrSet` method implements the **cache-aside** pattern: check cache → miss → call factory → write to cache → return. This is available for future use cases (e.g., rate limiting, session caching) even though the current login flow uses explicit `setWithExpiry`.

### 4.7 Domain Ports (`domain/interfaces/`)

The `domain/interfaces/` directory defines **port interfaces** — contracts that the domain depends on, implemented by infrastructure adapters. This is the same Ports & Adapters pattern used by `core_microservice`:

#### `ICacheService` — Cache port

```typescript
// apps/auth_microservice/src/domain/interfaces/cache.service.ts
export interface ICacheService {
  get(key: string): Promise<string | null>;
  setWithExpiry(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<number>;
  has(key: string): Promise<boolean>;
  getOrSet(key: string, factory: () => Promise<string>, ttlSeconds: number): Promise<string>;
}
```

Implemented by `RedisService` in `infrastructure/cache/`.

#### `IJwtService` — JWT port

```typescript
// apps/auth_microservice/src/domain/interfaces/jwt.service.interface.ts
export interface JwtPayload {
  sub: string;
  email: string;
}

export interface IJwtService {
  signAccessToken(payload: JwtPayload): string;
  verifyAccessToken(token: string): JwtPayload;
  generateRefreshToken(): string;
  parseExpiryToSeconds(expiry: string): number;
}
```

Implemented by `JwtService` in `infrastructure/jwt/`.

#### `ICryptoService` — Crypto port

```typescript
// apps/auth_microservice/src/domain/interfaces/crypto.service.interface.ts
export interface ICryptoService {
  hash(data: string, saltOrRounds?: number): Promise<string>;
  compare(data: string, encrypted: string): Promise<boolean>;
}
```

Implemented by `BcryptService` in `infrastructure/crypto/`. Previously co-located with `BcryptService`, now extracted to a separate domain port file following the Ports & Adapters pattern.

#### `IOAuthService` — OAuth port

```typescript
// apps/auth_microservice/src/domain/interfaces/oauth.service.interface.ts
export interface IOAuthPayload {
  email: string;
  sub: string;
}

export interface IOAuthService {
  verifyIdToken(token: string): Promise<IOAuthPayload>;
}
```

Implemented by `GoogleOAuthService` in `infrastructure/oauth/`. Extracting Google OAuth verification behind a port interface makes `AuthService` agnostic to the OAuth provider — swapping Google for another provider (Apple, GitHub, etc.) requires only a new adapter implementation.

#### `IAuthUserRepository` — Repository port

```typescript
// apps/auth_microservice/src/domain/interfaces/auth-user-repository.interface.ts
import { AuthUser } from '../entities/auth-user.entity';
import { RepositoryPort } from '@repo/shared';

export interface IAuthUserRepository extends RepositoryPort<AuthUser, any> {
  findByEmail(email: string): Promise<AuthUser | null>;
}
```

Implemented by `AuthUserRepository` in `infrastructure/repositories/`, which extends `TypeormRepositoryBase<AuthUser, any>`.

### 4.8 Infrastructure Adapters (`infrastructure/`)

Each port interface has a corresponding adapter implementation:

| Port (domain/interfaces/) | Adapter (infrastructure/) | Technology |
|---|---|---|
| `ICacheService` | `cache/redis.service.ts` (RedisService) | ioredis |
| `IJwtService` | `jwt/jwt.service.ts` (JwtService) | jsonwebtoken |
| `ICryptoService` | `crypto/crypto.service.ts` (BcryptService) | bcrypt |
| `IOAuthService` | `oauth/google-oauth.service.ts` (GoogleOAuthService) | google-auth-library |
| `IAuthUserRepository` | `repositories/auth-user.repository.ts` | TypeORM + TypeormRepositoryBase |

#### `AuthUserRepository`

Extends `TypeormRepositoryBase` from `@repo/shared` — the same pattern used by `core_microservice` repositories:

```typescript
// apps/auth_microservice/src/infrastructure/repositories/auth-user.repository.ts
import { TypeormRepositoryBase } from '@repo/shared';
import { DataSource } from 'typeorm';
import { AuthUser } from '../../domain/entities/auth-user.entity';
import { IAuthUserRepository } from '../../domain/interfaces/auth-user-repository.interface';

export class AuthUserRepository
  extends TypeormRepositoryBase<AuthUser, any>
  implements IAuthUserRepository
{
  public static readonly entity = AuthUser;
  protected relations: string[] = [];

  constructor(dataSource: DataSource) {
    super(dataSource.getRepository(AuthUser));
  }

  async findByEmail(email: string): Promise<AuthUser | null> {
    return this.repository.findOne({ where: { email } });
  }
}
```

Unlike `core_microservice` repositories (which use NestJS `@InjectRepository()`), the Express constructor takes `DataSource` directly and passes the native TypeORM repository to the base class via `super(dataSource.getRepository(AuthUser))`.

#### `BcryptService`

```typescript
// apps/auth_microservice/src/infrastructure/crypto/crypto.service.ts
import bcrypt from 'bcrypt';
import { ICryptoService } from '../../domain/interfaces/crypto.service.interface';

export class BcryptService implements ICryptoService {
  constructor(private readonly defaultSaltRounds: number = 10) {}

  async hash(data: string, saltOrRounds?: number): Promise<string> {
    const rounds = saltOrRounds || this.defaultSaltRounds;
    return bcrypt.hash(data, rounds);
  }

  async compare(data: string, encrypted: string): Promise<boolean> {
    return bcrypt.compare(data, encrypted);
  }
}
```

Note: `ICryptoService` is now defined in its own domain port file (`domain/interfaces/crypto.service.interface.ts`) rather than co-located with the adapter — a cleaner separation following the Ports & Adapters pattern. If another microservice needs it, promote the interface to `@repo/shared`.

### 4.9 Entities

`auth_microservice` has a single entity living in `domain/entities/`. The `AuthSession` table was removed — refresh token management is now entirely handled by Redis, making the database simpler and session state more ephemeral:

```typescript
// apps/auth_microservice/src/domain/entities/auth-user.entity.ts
import { Column, Entity } from 'typeorm';
import { TypeormEntityBase } from '@repo/shared';

@Entity('auth_users')
export class AuthUser extends TypeormEntityBase {
  @Column({ unique: true })
  email!: string;

  @Column({ nullable: true })
  passwordHash?: string;

  @Column({ nullable: true, unique: true })
  googleId?: string;

  @Column({ default: false })
  isEmailVerified!: boolean;

  @Column({ type: 'simple-array', nullable: true })
  roles?: string[];
}
```

`AuthUser` extends `TypeormEntityBase` (inherits `id`, `createdAt`, `updatedAt`, `deletedAt`).

**Key design notes:**
- **`passwordHash` is nullable** — Google-authenticated users don't have a password.
- **`googleId` column** — stores the Google account identifier for OAuth users. Unique constraint ensures one Google account maps to one user.
- **`isEmailVerified`** — set to `true` automatically for Google-authenticated users (Google has already verified the email), `false` for email/password registrations.
- **`AuthSession` entity was removed** — sessions were previously stored in a database table, but refresh tokens are now managed exclusively in Redis (via `ICacheService`). This is simpler, faster (no DB round-trip on every refresh), and aligns with the principle that session state should be ephemeral. Redis TTL (`EX` flag) handles automatic cleanup — no cron job needed for expired sessions.

### 4.10 Summary: NestJS vs. Express Mapping

| Concern | NestJS (`core_microservice`) | Express (`auth_microservice`) |
|---|---|---|
| **Entry point** | `main.ts` → `NestFactory.create(AppModule)` | `main.ts` → `createApp(dataSource, logger, redisService)` |
| **Module wiring** | `@Module({ imports, controllers, providers })` | Manual construction in `createApp()` |
| **DI** | NestJS IoC container (`@Injectable`, constructor injection) | Manual constructor injection via `new()` in `createApp()` |
| **Layering** | `domain/entities/`, `domain/interfaces/`, `infrastructure/`, `dto/` | `domain/entities/`, `domain/interfaces/`, `infrastructure/`, `services/`, `routes/` |
| **Controllers** | `@Controller('path')` + `@Get`/`@Post` decorators | `Router` factory functions with `router.post(...)` |
| **Validation** | Global `ValidationPipe` (whitelist, transform) | Per-route `validateBody(DtoClass)` middleware |
| **Error mapping** | `DomainExceptionFilter` (global NestJS exception filter) | `errorHandler` (global Express middleware) |
| **Services** | `@Injectable()` classes injected by NestJS | Plain classes with explicit `new()` construction |
| **Repository pattern** | `TypeormRepositoryBase` + `@InjectRepository()` | `TypeormRepositoryBase` via `super(dataSource.getRepository())` |
| **Port interfaces** | Domain interfaces + NestJS DI tokens | Domain interfaces + manual binding in `createApp()` |
| **Auth middleware** | NestJS `@UseGuards(AuthGuard)` or Passport strategies | `requireAuth(authService)` factory middleware + `req.user` augmentation |
| **Graceful shutdown** | NestJS lifecycle hooks (`onApplicationShutdown`) | Manual `process.on('SIGINT'/'SIGTERM')` handlers |
| **Swagger** | `@nestjs/swagger` decorators | `swagger-jsdoc` + `swagger-ui-express` with JSDoc comments |

---

## 5. Request Lifecycle — `core_microservice` (NestJS)

Let's trace a `POST /profiles` request end-to-end.

### Step 1: HTTP Entry Point

```
POST /profiles
Body: { "authUserId": "uuid-123", "handle": "john_doe" }
```

NestJS routes the request to `ProfilesController.createProfile()`.

### Step 2: Global Validation Pipe

`main.ts` registers a global `ValidationPipe`:

```typescript
// apps/core_microservice/src/main.ts
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
```

This pipe intercepts the `@Body()` parameter. It:
1. **Transforms** the plain JSON into an instance of `CreateProfileDto` (via `class-transformer`).
2. **Validates** the instance against its decorators (`@IsUUID()`, `@MinLength(3)`, `@MaxLength(30)`).
3. **Strips** unknown properties (`whitelist: true`).
4. If validation fails, throws a `BadRequestException` (HTTP 400) immediately — the controller method is never called.

### Step 3: Controller Delegates to Service

```typescript
const profile = await this.profilesService.createProfile(
  createProfileDto.authUserId,   // "uuid-123"
  createProfileDto.handle,        // "john_doe"
);
```

### Step 4: Service Uses Entity Factory

```typescript
const profile = UserProfile.create({ authUserId, username: handle });
```

The `create()` static factory:
- Defaults `displayName` to `username` if no display name is provided.
- Returns a **valid but unsaved** `UserProfile` instance. No business rules can be violated because the factory controls all construction paths.

### Step 5: Service Persists via Repository

```typescript
return this.userProfileRepository.save(profile);
```

`UserProfileRepository.save()` is inherited from `TypeormRepositoryBase`. It:

1. Calls `this.repository.save(entity)` (TypeORM's `Repository<Entity>.save()`).
2. If TypeORM throws a `QueryFailedError` with PostgreSQL error code `23505` (unique violation), the base class catches it and re-throws as `UniqueConstraintViolationError` — which the `DomainExceptionFilter` maps to HTTP 409.
3. Logs the persistence: `[UserProfile] persisted <uuid>`.
4. Returns the saved entity (now with populated `id`, `createdAt`, `updatedAt`).

### Step 6: Controller Maps Entity to Response DTO

```typescript
return new ProfileResponseDto(profile);
```

The `ProfileResponseDto` constructor:
- Copies primitive fields as-is.
- Normalizes `bio` and `avatarUrl`: `undefined` → `null` (since JSON has no `undefined`).
- Converts `createdAt` and `updatedAt` from `Date` objects to ISO 8601 strings.
- **Intentionally omits** `deletedAt` — it is an internal column never exposed to clients.

### Step 7: NestJS Serializes to JSON

NestJS serializes the `ProfileResponseDto` instance to JSON (using `class-transformer` behind the scenes), respecting `@ApiProperty()` metadata for Swagger/OpenAPI documentation.

### Step 8: What Happens on Error

If any step throws a `DomainError`:
- `EntityByIdNotFoundError`, `EntityNotFoundError` → 404
- `UniqueConstraintViolationError` → 409
- `InvalidDisplayNameError`, `InvalidProfileBioError`, `InvalidPostStateError`, `EmptyCommentError` → 400 (default for unrecognized `DomainError` subclasses)
- `DatabaseQueryError` → 500

The `DomainExceptionFilter` catches all of them globally and returns a consistent JSON error envelope:

```json
{
  "statusCode": 404,
  "error": "EntityByIdNotFoundError",
  "message": "user_profiles with id \"bad-uuid\" not found"
}
```

### Visual Summary

```
HTTP Request
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  ValidationPipe (global)                                │
│  JSON body → CreateProfileDto instance → validate       │
│  On failure: HTTP 400 (BadRequestException)             │
└─────────────────────────────────────────────────────────┘
    │ (valid)
    ▼
┌─────────────────────────────────────────────────────────┐
│  ProfilesController.createProfile()                     │
│  Thin: extract params, call service, map to ResponseDto │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  ProfilesService.createProfile()                        │
│  Orchestration: call entity factory, then repository    │
│  1. UserProfile.create(props)  ← domain rules          │
│  2. repository.save(profile)    ← persistence          │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  UserProfileRepository.save()                           │
│  Inherited from TypeormRepositoryBase                   │
│  1. TypeORM Repository.save(entity)                     │
│  2. Catch QueryFailedError → UniqueConstraintViolation  │
│  3. Log, return saved entity                            │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  ProfileResponseDto constructor                         │
│  Entity → wire format: ISO dates, null normalization,   │
│  omit internal fields                                   │
└─────────────────────────────────────────────────────────┘
    │
    ▼
  JSON Response
    │
    ▼
  (if any DomainError was thrown along the way)
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  DomainExceptionFilter (global)                         │
│  DomainError → HTTP status code + JSON error body       │
└─────────────────────────────────────────────────────────┘
```

---

## 6. Developer Cookbook: Adding a New Feature Module

> **This section applies to `core_microservice` (NestJS Hexagonal Architecture).** For adding features to `auth_microservice`, follow the Express patterns in [Section 4](#4-express--manual-di-architecture--auth_microservice).

This section is a step-by-step checklist for adding a completely new domain module — for example, a **"Bookmarks"** feature where users can bookmark posts.

### Checklist

#### Step 1: Plan the Module Folder Structure

Create the folder tree inside `apps/core_microservice/src/modules/bookmarks/`:

```
bookmarks/
├── bookmarks.module.ts
├── bookmarks.controller.ts
├── bookmarks.service.ts
├── domain/
│   ├── entities/
│   │   ├── bookmark.entity.ts
│   │   └── bookmark.entity.spec.ts
│   ├── interfaces/
│   │   ├── bookmark.props.ts
│   │   └── bookmark-repository.port.ts
│   └── errors/
│       └── bookmark.errors.ts
├── dto/
│   ├── create-bookmark.dto.ts
│   └── bookmark-response.dto.ts
├── infrastructure/
│   └── repository/
│       └── bookmark.repository.ts
└── __tests__/
    └── fakers/
        ├── index.ts
        └── bookmark.faker.ts
```

#### Step 2: Define the Domain Props Interface

```typescript
// bookmarks/domain/interfaces/bookmark.props.ts
export interface BookmarkProps {
  userId: string;
  postId: string;
}
```

#### Step 3: Create the Domain Entity

```typescript
// bookmarks/domain/entities/bookmark.entity.ts
import { Entity, Column, Index, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { TypeormEntityBase } from '@repo/shared';
import type { Post } from '../../../posts/domain/entities/post.entity';
import type { UserProfile } from '../../../profiles/domain/entities/user-profile.entity';

@Entity('bookmarks')
@Unique(['userId', 'postId'])   // One bookmark per user per post
export class Bookmark extends TypeormEntityBase {
  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne('UserProfile')
  @JoinColumn({ name: 'userId' })
  user!: UserProfile;

  @Index()
  @Column({ type: 'uuid' })
  postId!: string;

  @ManyToOne('Post')
  @JoinColumn({ name: 'postId' })
  post!: Post;

  static create(props: { userId: string; postId: string }): Bookmark {
    const bookmark = new Bookmark();
    bookmark.userId = props.userId;
    bookmark.postId = props.postId;
    return bookmark;
  }
}
```

**Rules to follow:**
- Always extend `TypeormEntityBase` for entities that need `id`, `createdAt`, `updatedAt`, `deletedAt`.
- Use `type`-only imports for cross-module references to keep modules decoupled at runtime.
- Provide a `static create()` factory that enforces construction invariants.

#### Step 4: Define Domain Errors (if the entity has business rules)

```typescript
// bookmarks/domain/errors/bookmark.errors.ts
import { DomainError } from '@repo/shared';

export class DuplicateBookmarkError extends DomainError {
  constructor(userId: string, postId: string) {
    super(`User ${userId} has already bookmarked post ${postId}.`);
  }
}
```

#### Step 5: Define the Repository Port

```typescript
// bookmarks/domain/interfaces/bookmark-repository.port.ts
import type { RepositoryPort } from '@repo/shared';
import type { Bookmark } from '../../domain/entities/bookmark.entity';
import type { BookmarkProps } from './bookmark.props';

export interface IBookmarkRepository extends RepositoryPort<Bookmark, BookmarkProps> {
  findByUserId(userId: string): Promise<Bookmark[]>;
  findByUserAndPost(userId: string, postId: string): Promise<Bookmark | null>;
}
```

#### Step 6: Create the Request/Response DTO

```typescript
// bookmarks/dto/create-bookmark.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateBookmarkDto {
  @ApiProperty()
  @IsUUID()
  postId!: string;
}
```

```typescript
// bookmarks/dto/bookmark-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { Bookmark } from '../domain/entities/bookmark.entity';

export class BookmarkResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() userId: string;
  @ApiProperty() postId: string;
  @ApiProperty() createdAt: string;

  constructor(bookmark: Bookmark) {
    this.id = bookmark.id;
    this.userId = bookmark.userId;
    this.postId = bookmark.postId;
    this.createdAt = bookmark.createdAt.toISOString();
  }
}
```

#### Step 7: Implement the Infrastructure Repository

```typescript
// bookmarks/infrastructure/repository/bookmark.repository.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { TypeormRepositoryBase } from '@repo/shared';
import { Bookmark } from '../../domain/entities/bookmark.entity';
import type { BookmarkProps } from '../../domain/interfaces/bookmark.props';
import type { IBookmarkRepository } from '../../domain/interfaces/bookmark-repository.port';

@Injectable()
export class BookmarkRepository
  extends TypeormRepositoryBase<Bookmark, BookmarkProps>
  implements IBookmarkRepository
{
  public static readonly entity = Bookmark;
  protected relations: string[] = ['post'];

  constructor(@InjectRepository(Bookmark) repository: Repository<Bookmark>) {
    super(repository);
  }

  async findByUserId(userId: string): Promise<Bookmark[]> {
    return this.repository.find({ where: { userId }, relations: { post: true } });
  }

  async findByUserAndPost(userId: string, postId: string): Promise<Bookmark | null> {
    return this.repository.findOne({ where: { userId, postId } });
  }
}
```

#### Step 8: Create the Service

```typescript
// bookmarks/bookmarks.service.ts
import { Injectable } from '@nestjs/common';
import { Bookmark } from './domain/entities/bookmark.entity';
import { BookmarkRepository } from './infrastructure/repository/bookmark.repository';

@Injectable()
export class BookmarksService {
  constructor(private readonly bookmarkRepository: BookmarkRepository) {}

  async createBookmark(userId: string, postId: string): Promise<Bookmark> {
    const existing = await this.bookmarkRepository.findByUserAndPost(userId, postId);
    if (existing) {
      return existing; // Idempotent — or throw DuplicateBookmarkError
    }
    const bookmark = Bookmark.create({ userId, postId });
    return this.bookmarkRepository.save(bookmark);
  }

  async getUserBookmarks(userId: string): Promise<Bookmark[]> {
    return this.bookmarkRepository.findByUserId(userId);
  }

  async removeBookmark(id: string): Promise<void> {
    const bookmark = await this.bookmarkRepository.findOneByIdOrThrow(id);
    await this.bookmarkRepository.delete(bookmark);
  }
}
```

#### Step 9: Create the Controller

```typescript
// bookmarks/bookmarks.controller.ts
import { Controller, Get, Post, Delete, Param, ParseUUIDPipe, Body } from '@nestjs/common';
import { BookmarksService } from './bookmarks.service';
import { CreateBookmarkDto } from './dto/create-bookmark.dto';
import { BookmarkResponseDto } from './dto/bookmark-response.dto';

@Controller('bookmarks')
export class BookmarksController {
  constructor(private readonly bookmarksService: BookmarksService) {}

  @Post()
  async create(
    @Body() dto: CreateBookmarkDto,
    // TODO: extract userId from JWT when auth is wired up
  ): Promise<BookmarkResponseDto> {
    const bookmark = await this.bookmarksService.createBookmark('temp-user-id', dto.postId);
    return new BookmarkResponseDto(bookmark);
  }

  @Get('user/:userId')
  async getUserBookmarks(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<BookmarkResponseDto[]> {
    const bookmarks = await this.bookmarksService.getUserBookmarks(userId);
    return bookmarks.map(b => new BookmarkResponseDto(b));
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.bookmarksService.removeBookmark(id);
  }
}
```

#### Step 10: Create the Module

```typescript
// bookmarks/bookmarks.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bookmark } from './domain/entities/bookmark.entity';
import { BookmarksService } from './bookmarks.service';
import { BookmarksController } from './bookmarks.controller';
import { BookmarkRepository } from './infrastructure/repository/bookmark.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Bookmark])],
  controllers: [BookmarksController],
  providers: [BookmarksService, BookmarkRepository],
})
export class BookmarksModule {}
```

#### Step 11: Register the Module in AppModule

```typescript
// app.module.ts — add the import
import { BookmarksModule } from './modules/bookmarks/bookmarks.module';

@Module({
  imports: [
    // ... existing imports ...
    BookmarksModule,   // ← add this
  ],
})
export class AppModule {}
```

#### Step 12: Create the Migration

Generate a TypeORM migration for the new `bookmarks` table:

```bash
cd apps/core_microservice
npx typeorm migration:create src/migrations/AddBookmarks -d src/data-source.ts
```

Write the SQL for the `bookmarks` table with columns `id`, `userId`, `postId`, the `@Unique` constraint, and the standard audit columns.

#### Step 13: Write Tests

1. **Domain unit test** (`bookmark.entity.spec.ts`) — test the `create()` factory.
2. **Service spec** (`bookmarks.service.spec.ts`) — mock the repository and test orchestration.
3. **Controller spec** (`bookmarks.controller.spec.ts`) — mock the service and test HTTP mapping.
4. **Faker** (`__tests__/fakers/bookmark.faker.ts`) — a factory function returning a fully-populated `Bookmark` with sensible defaults.

### Key Rules to Remember

| Rule | Rationale |
|------|-----------|
| Business logic lives in entity methods, not services | Entities stay unit-testable without mocking NestJS |
| Entity construction uses a `static create()` factory | Prevents inconsistent object construction |
| Mutations go through domain methods (e.g. `profile.editBio()`) | Domain rules execute on every mutation path |
| Domain errors extend `DomainError` from `@repo/shared` | Mapped to HTTP by the global exception filter |
| Repository extends `TypeormRepositoryBase<Entity, Props>` | All CRUD operations inherited for free |
| Response DTOs have a constructor that takes the entity | Single, auditable mapping from domain → wire |
| Use `type`-only imports for cross-module entities | No runtime circular dependency between modules |
| `@Unique` decorator at the entity level | Maps to a database unique constraint and is caught by `UniqueConstraintViolationError` |
| Response DTOs use ISO strings, not `Date` objects | Dates in JSON are always strings |
| Response DTOs normalize optional fields to `null` | `undefined` is not valid JSON |

---

## Appendix: Project-Wide Pattern Reference

### A.1 All Module Folders in `core_microservice`

| Module | Domain Entities | Has Repository? | Notes |
|--------|----------------|-----------------|-------|
| `profiles` | `UserProfile`, `ProfileToProfileConfiguration` | Yes (`UserProfileRepository`) | Canonical reference module |
| `posts` | `Post`, `PostLike`, `PostAsset` | Yes (`PostRepository`) | Demonstrates `publish()` state machine pattern |
| `comments` | `Comment`, `CommentLike` | Yes (`CommentRepository`) | Demonstrates self-referencing `parentId` for nested comments |
| `chats` | `Chat`, `ChatParticipant`, `Message`, `MessageAsset` | No (uses raw TypeORM) | To be refactored to the repository pattern |
| `follows` | `Follow` | No (uses raw TypeORM) | To be refactored to the repository pattern |
| `assets` | `Asset` | No (uses raw TypeORM) | To be refactored to the repository pattern |

### A.2 All Modules in `auth_microservice`

| Area | Source files | Description |
|------|-------------|-------------|
| Domain entities | `domain/entities/auth-user.entity.ts` | Single TypeORM entity (AuthUser with nullable passwordHash + googleId; AuthSession removed) |
| Domain ports | `domain/interfaces/auth-user-repository.interface.ts`, `domain/interfaces/cache.service.ts`, `domain/interfaces/crypto.service.interface.ts`, `domain/interfaces/jwt.service.interface.ts`, `domain/interfaces/oauth.service.interface.ts` | Port interfaces: IAuthUserRepository, ICacheService, ICryptoService, IJwtService, IOAuthService |
| Infrastructure adapters | `infrastructure/repositories/auth-user.repository.ts`, `infrastructure/cache/redis.service.ts`, `infrastructure/jwt/jwt.service.ts`, `infrastructure/crypto/crypto.service.ts`, `infrastructure/oauth/google-oauth.service.ts` | Adapters: AuthUserRepository, RedisService, JwtService, BcryptService, GoogleOAuthService |
| Services | `services/auth.service.ts`, `services/users.service.ts` | Application services depending on port interfaces |
| Routes | `routes/auth.routes.ts` (login, Google OAuth, refresh, logout, me), `routes/users.routes.ts` | Router factory functions |
| Middleware | `middleware/auth.middleware.ts`, `middleware/validate.middleware.ts`, `middleware/error-handler.middleware.ts` | requireAuth (JWT), validateBody (class-validator), errorHandler |
| Types | `types/express.d.ts` | Global Express Request augmentation (`req.user: JwtPayload`) |
| Config | `config/env.ts`, `config/database.ts`, `config/redis.ts`, `config/jwt.ts`, `config/google.ts`, `config/swagger.ts` | Centralized env.ts + infrastructure configuration |
| Migrations | `migrations/1782126100129-InitialAuthSchema.ts`, `migrations/1785236513612-AddGoogleOAuthToUsers.ts` | DB schema migrations |

### A.3 Global Infrastructure Register in `main.ts`

**`core_microservice` (NestJS):**
```typescript
// Global validation pipe — runs before every controller method
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

// Global domain error → HTTP translation
app.useGlobalFilters(new DomainExceptionFilter());
```

**`auth_microservice` (Express):**
```typescript
// Validation is per-route: router.post('/path', validateBody(Dto), handler)
// Error mapping is a global middleware: app.use(errorHandler)
// Port bindings happen in createApp():
//   - ICryptoService → BcryptService
//   - IAuthUserRepository → AuthUserRepository
//   - ICacheService → RedisService
//   - IJwtService → JwtService
//   - IOAuthService → GoogleOAuthService
```

These globals are the backbone of the hexagonal architecture's outer layer — they handle cross-cutting concerns so individual modules never need to think about validation syntax or HTTP status codes.

### A.4 TypeORM Entity Registration

**`core_microservice` (NestJS):**
- Each module registers its entities via `TypeOrmModule.forFeature([Entity1, Entity2])`.
- The root `AppModule` uses `autoLoadEntities: true` — TypeORM discovers them automatically.

**`auth_microservice` (Express):**
- Entities are listed explicitly in the `DataSource` configuration's `entities: [AuthUser]` array in `config/database.ts` (AuthSession removed — sessions are Redis-only).
- A single entity lives in `domain/entities/` (not a top-level `entities/` directory), reflecting the DDD layering.
- No `autoLoadEntities` — the list is maintained manually.

### A.5 Shared DTOs That Live in `@repo/shared`

| DTO | Used by |
|-----|---------|
| `CreateUserDto` | `auth_microservice` |
| `LoginDto` | `auth_microservice` |
| `GoogleLoginDto` | `auth_microservice` |
| `RefreshTokenDto` | `auth_microservice` |
| `CreatePostDto` | `core_microservice` |
| `UpdatePostDto` | `core_microservice` |
| `CreateCommentDto` | `core_microservice` |
| `UpdateCommentDto` | `core_microservice` |
| `UpdateProfileDto` | `core_microservice` |

If a new DTO is only needed by one module, it belongs in the module's `dto/` folder. If two or more services need it, promote it to `@repo/shared/dtos/`.

### A.6 Shared Domain Errors in `@repo/shared`

| Error class | Used by | Mapped to HTTP |
|-------------|---------|----------------|
| `DomainError` (abstract) | Both | (base class) |
| `EntityByIdNotFoundError` | `core_microservice` | 404 |
| `EntityNotFoundError` | Both | 404 |
| `UniqueConstraintViolationError` | Both | 409 |
| `UnauthorizedError` | `auth_microservice` | 401 |
| `DatabaseQueryError` | Both | 500 |

### A.7 Contracts Currently Defined in `@repo/contracts`

| Contract | Kind |
|----------|------|
| `ICreateProfileRequest` | Request |
| `IUpdateProfileRequest` | Request |
| `IProfileResponse` | Response |
| `IPaginatedResponse<T>` | Common response envelope |
| `IPaginationMeta` | Common pagination metadata |
| `PAGINATION_DEFAULTS` | Common constants |

When adding a new feature, consider whether the frontend needs a contract. If yes, add the interface to `@repo/contracts` and have the backend DTO `implements` it.

---

*This guide reflects the architecture as of July 2026. If you find discrepancies between the guide and the code, the code is authoritative — please update the guide accordingly.*
