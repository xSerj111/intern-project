import * as winston from "winston";
import { LogData, LogLevel, Logger } from "./logger.port";

export interface WinstonLoggerOptions {
  /** Minimum level to emit (winston threshold). Defaults to `debug`. */
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
 * Process-wide uncaughtException / unhandledRejection handlers. winston adds
 * one process listener per logger that sets them, so they are registered once
 * on a dedicated logger instead of on every WinstonLogger instance.
 */
let processHandlersLogger: winston.Logger | undefined;

function ensureProcessHandlers(createTransport: () => winston.transport): void {
  if (processHandlersLogger) return;
  const transport = createTransport();
  processHandlersLogger = winston.createLogger({
    levels: LEVELS,
    transports: [transport],
    exceptionHandlers: [transport],
    rejectionHandlers: [transport],
  });
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

    this.logger = winston.createLogger({
      level: options.level ?? LogLevel.Debug,
      levels: LEVELS,
      transports: [this.createConsoleTransport(pretty)],
    });
    ensureProcessHandlers(() => this.createConsoleTransport(pretty));
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
    this.logger.log(level, message, { context: this.context, ...data });
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
    this.logger.log(level, stringify(message), {
      ...(context ? { context } : {}),
      ...data,
      ...(stack ? { stack } : {}),
    });
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
