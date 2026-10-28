import { DomainError } from "./domain.error";

/** The caller is authenticated but not allowed to perform the action (403). */
export class AccessDeniedError extends DomainError {
  constructor(message = "Access denied") {
    super(message);
  }
}
