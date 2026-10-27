import * as winston from "winston";
import { currentRequestId } from "../observability/request-context";
import { LogData, LogLevel, Logger } from "./logger.port";

export interface WinstonLoggerOptions {
  /**
   * Minimum level to emit (winston threshold). Defaults to `LOG_LEVEL`, else
   * `info` when `NODE_ENV=production` and `debug` otherwise.
   */
  level?: LogLevel;
  /** Colorized human-readable output (dev) vs JSON (prod). */
  pretty?: boolean;
}

/** Shape we put on the winston `info` object via the meta argument. */
interface PrettyLogInfo {
  timestamp?: string;
  level: string;
  message: string;
  context?: string;
  correlationId?: string;
  stack?: string;
  props?: Record<string, unknown>;
}

// Lower number = higher priority (winston convention).
const LEVELS: Record<string, number> = {
  [LogLevel.Error]: 0,
  [LogLevel.Warn]: 1,
  [LogLevel.Info]: 2,
  [LogLevel.Debug]: 3,
  [LogLevel.Verbose]: 4,
};

const LEVEL_VALUES = new Set<string>(Object.values(LogLevel));

const isLogLevel = (value: unknown): value is LogLevel =>
  typeof value === "string" && LEVEL_VALUES.has(value);

const isLogData = (value: unknown): value is LogData =>
  typeof value === "object" && value !== null && !(value instanceof Error);

const looksLikeStack = (value: string): boolean => /\n\s+at /.test(value);

const stringify = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

/**
 * Level from `LOG_LEVEL` when it names a {@link LogLevel}; otherwise `info` in
 * production and `debug` elsewhere. `invalid` carries a rejected value.
 */
export function resolveLogLevel(env: NodeJS.ProcessEnv = process.env): {
  level: LogLevel;
  invalid?: string;
} {
  const fallback = env.NODE_ENV === "production" ? LogLevel.Info : LogLevel.Debug;
  const raw = env.LOG_LEVEL?.trim().toLowerCase();
  if (!raw) return { level: fallback };
  if (isLogLevel(raw)) return { level: raw };
  return { level: fallback, invalid: env.LOG_LEVEL };
}

/** An invalid `LOG_LEVEL` is reported once per process, not per logger. */
let invalidLevelWarned = false;

/** Adds the current request id unless the caller passed a correlation id. */
function withCorrelationId<T extends { correlationId?: string }>(meta: T): T {
  if (meta.correlationId) return meta;
  const correlationId = currentRequestId();
  return correlationId ? { ...meta, correlationId } : meta;
}

type FatalProcessEvent = "uncaughtException" | "unhandledRejection";

/** Set by `createErrorsCounter` so process errors count as `source="process"`. */
let processErrorRecorder: ((error: unknown) => void) | undefined;

export function setProcessErrorRecorder(
  recorder: ((error: unknown) => void) | undefined,
): void {
  processErrorRecorder = recorder;
}

/**
 * The single process-error path: one JSON line on stderr (with stack and the
 * current request id), one `errors_total{source="process"}` increment, then
 * exit 1. Written synchronously so nothing is lost before the exit.
 */
export function handleFatalProcessError(
  event: FatalProcessEvent,
  reason: unknown,
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  try {
    const error = reason instanceof Error ? reason : undefined;
    const correlationId = currentRequestId();
    process.stderr.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: LogLevel.Error,
        message: error ? error.message : stringify(reason),
        context: "Process",
        event,
        errorType: error?.name ?? "NonError",
        ...(correlationId ? { correlationId } : {}),
        ...(error?.stack ? { stack: error.stack } : {}),
      })}\n`,
    );
    processErrorRecorder?.(reason);
  } catch {
    // Never let reporting prevent the exit.
  } finally {
    exit(1);
  }
}

/**
 * Registers the process-wide uncaughtException / unhandledRejection handlers
 * once (not per WinstonLogger instance). winston's own exception/rejection
 * handlers are not used, so each fatal error is logged exactly once.
 */
let processHandlersInstalled = false;

function ensureProcessHandlers(): void {
  if (processHandlersInstalled) return;
  processHandlersInstalled = true;
  process.on("uncaughtException", (error) =>
    handleFatalProcessError("uncaughtException", error),
  );
  process.on("unhandledRejection", (reason) =>
    handleFatalProcessError("unhandledRejection", reason),
  );
}

/**
 * winston-backed {@link Logger}. Default implementation across all services.
 * Pretty colorized console in dev, structured JSON in production.
 *
 * Also satisfies Nest's `LoggerService` (`log`/`error`/`warn`/`debug`/
 * `verbose`/`fatal` with `(message, ...optionalParams)`), so it can be passed
 * to `NestFactory.create({ logger })`.
 */
export class WinstonLogger implements Logger {
  private readonly logger: winston.Logger;

  constructor(
    private readonly context?: string,
    options: WinstonLoggerOptions = {},
  ) {
    const pretty = options.pretty ?? process.env.NODE_ENV !== "production";

    const resolved = resolveLogLevel();

    this.logger = winston.createLogger({
      level: options.level ?? resolved.level,
      levels: LEVELS,
      transports: [this.createConsoleTransport(pretty)],
    });
    if (resolved.invalid !== undefined && !invalidLevelWarned) {
      invalidLevelWarned = true;
      this.logger.warn(
        `Invalid LOG_LEVEL "${resolved.invalid}"; using "${resolved.level}"`,
        { context: "WinstonLogger" },
      );
    }
    ensureProcessHandlers();
  }

  log(level: LogLevel, message: string, data?: LogData): void;
  /** Nest `LoggerService` form: `(message, context?)`. */
  log(message: unknown, ...optionalParams: unknown[]): void;
  log(first: unknown, ...rest: unknown[]): void {
    const [second, third] = rest;
    if (
      isLogLevel(first) &&
      typeof second === "string" &&
      rest.length <= 2 &&
      (third === undefined || isLogData(third))
    ) {
      this.write(first, second, third);
      return;
    }
    this.writeNest(LogLevel.Info, first, rest);
  }

  error(message: string | Error, data?: LogData): void;
  /** Nest `LoggerService` form: `(message, stack?, context?)`. */
  error(message: unknown, ...optionalParams: unknown[]): void;
  error(message: unknown, ...rest: unknown[]): void {
    this.writeNest(LogLevel.Error, message, rest);
  }

  warn(message: string, data?: LogData): void;
  warn(message: unknown, ...optionalParams: unknown[]): void;
  warn(message: unknown, ...rest: unknown[]): void {
    this.writeNest(LogLevel.Warn, message, rest);
  }

  info(message: string, data?: LogData): void {
    this.write(LogLevel.Info, message, data);
  }

  debug(message: string, data?: LogData): void;
  debug(message: unknown, ...optionalParams: unknown[]): void;
  debug(message: unknown, ...rest: unknown[]): void {
    this.writeNest(LogLevel.Debug, message, rest);
  }

  verbose(message: string, data?: LogData): void;
  verbose(message: unknown, ...optionalParams: unknown[]): void;
  verbose(message: unknown, ...rest: unknown[]): void {
    this.writeNest(LogLevel.Verbose, message, rest);
  }

  /** Nest `fatal` has no winston counterpart; emitted at `error` level. */
  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.writeNest(LogLevel.Error, message, optionalParams);
  }

  private write(level: LogLevel, message: string, data?: LogData): void {
    this.logger.log(
      level,
      message,
      withCorrelationId({ context: this.context, ...data }),
    );
  }

  /**
   * Maps a `(message, ...params)` call to a winston entry. A trailing string
   * param is the context; for errors a preceding string is the stack. A
   * `LogData` object or `Error` param is used as structured data.
   */
  private writeNest(level: LogLevel, message: unknown, params: unknown[]): void {
    const strings = params.filter((p): p is string => typeof p === "string");
    const obj = params.find(isLogData);
    const errorParam = params.find((p) => p instanceof Error);
    let context = this.context;
    let stack: string | undefined;

    if (level === LogLevel.Error) {
      const withStack =
        strings.length > 1 || (strings.length === 1 && looksLikeStack(strings[0]));
      if (withStack) stack = strings[0];
      if (strings.length > 1 || (strings.length === 1 && !withStack)) {
        context = strings[strings.length - 1];
      }
    } else if (strings.length > 0) {
      context = strings[strings.length - 1];
    }

    const err = message instanceof Error ? message : (errorParam ?? obj?.error);
    if (err instanceof Error) stack ??= err.stack;

    const { error: _error, ...data } = obj ?? {};
    this.logger.log(
      level,
      stringify(message),
      withCorrelationId({
        ...(context ? { context } : {}),
        ...data,
        ...(stack ? { stack } : {}),
      }),
    );
  }

  private createConsoleTransport(pretty: boolean): winston.transport {
    const { combine, timestamp, json, colorize, printf } = winston.format;

    if (!pretty) {
      return new winston.transports.Console({
        format: combine(
          timestamp({ format: "YYYY-MM-DDTHH:mm:ss.SSSZ" }),
          winston.format.errors({ stack: true }),
          json(),
        ),
      });
    }

    winston.addColors({
      error: "red",
      warn: "yellow",
      info: "green",
      debug: "blue",
      verbose: "cyan",
    });

    return new winston.transports.Console({
      format: combine(
        colorize({ all: true }),
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        printf((info) => {
          const log = info as unknown as PrettyLogInfo;
          const ctx = log.context ? ` [${log.context}]` : "";
          const corr = log.correlationId ? ` [${log.correlationId}]` : "";
          const props = log.props ? ` ${JSON.stringify(log.props)}` : "";
          const stack = log.stack ? `\n${log.stack}` : "";
          return `${log.timestamp ?? ""} ${log.level}${corr}${ctx}: ${log.message}${props}${stack}`;
        }),
      ),
    });
  }
}
