/**
 * Base class for framework-agnostic domain errors.
 *
 * Entities throw these to enforce business rules without depending on NestJS or
 * HTTP. That keeps the rules unit-testable in isolation; an exception filter can
 * later map each `DomainError` subclass to the appropriate HTTP response.
 */
export abstract class DomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
    // Restore the prototype chain so `instanceof` works after transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
