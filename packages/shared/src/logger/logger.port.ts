export enum LogLevel {
  Error = "error",
  Warn = "warn",
  Info = "info",
  Debug = "debug",
  Verbose = "verbose",
}

/**
 * Structured context attached to a log entry.
 */
export interface LogData {
  /** Originating class/context, e.g. "UserProfileRepository". */
  context?: string;
  /** Correlation/trace id for the current request. */
  correlationId?: string;
  /** The error object, when logging a failure. */
  error?: unknown;
  /** Arbitrary structured fields. */
  props?: Record<string, unknown>;
}

/**
 * DI token. Depend on `@Inject(LoggerKey) logger: Logger` to bind to the
 * abstraction instead of a concrete implementation.
 */
export const LoggerKey = Symbol.for("innogram.Logger");

/**
 * Logging port shared across all services. Implementations (console, winston,
 * pino, ...) live behind this interface so call sites never change.
 */
export interface Logger {
  log(level: LogLevel, message: string, data?: LogData): void;
  error(message: string | Error, data?: LogData): void;
  warn(message: string, data?: LogData): void;
  info(message: string, data?: LogData): void;
  debug(message: string, data?: LogData): void;
  verbose(message: string, data?: LogData): void;
}
