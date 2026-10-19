// DTOs
export * from "./dtos/auth/create-user.dto";
export * from "./dtos/auth/login.dto";
export * from "./dtos/core/update-profile.dto";
export * from "./dtos/core/posts-by-author-query.dto";
export * from "./dtos/core/create-comment.dto";
export * from "./dtos/core/update-comment.dto";
export * from "./dtos/auth/google-login.dto";

// Events
export * from "./events/user-created.event";
export * from "./events/session-revoked.event";
export * from "./events/event-envelope";
export * from "./events/social.events";
export * from "./events/chat-message-alerted.event";
export * from "./events/notification.events";
export * from "./events/email-job";

// NOTE: API contracts (request/response interfaces) live in the dependency-free
// `@repo/contracts` package so the frontend can import them without pulling in
// the backend stack (typeorm / nestjs / winston).

// Logger (shared logging port + default winston implementation)
export * from "./logger";

// Database infrastructure (entity base, repository port + TypeORM adapter)
export * from "./database/typeorm-entity.base";
export * from "./database/repository.port";
export * from "./database/typeorm-repository.base";
export * from "./database/postgres-error-code.enum";
export * from "./database/typeorm-error.guard";

// Errors (framework-agnostic domain + database errors)
export * from "./errors/domain.error";
export * from "./errors/database.errors";
export * from "./errors/access-denied.error";

// Auth (shared access-token verifier)
export * from "./auth/access-token.verifier";

// Redis key layout (auth sessions + token blacklists)
export * from "./redis/redis-keys";

// Filters (domain errors -> HTTP)
export * from "./filters/domain-exception.filter";

// Types/Enums (we will add these later)
