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

/**
 * winston-backed {@link Logger}. Default implementation across all services.
 * Pretty colorized console in dev, structured JSON in production.
 */
export class WinstonLogger implements Logger {
  private readonly logger: winston.Logger;

  constructor(
    private readonly context?: string,
    options: WinstonLoggerOptions = {},
  ) {
    const pretty = options.pretty ?? process.env.NODE_ENV !== "production";
    const transport = this.createConsoleTransport(pretty);

    this.logger = winston.createLogger({
      level: options.level ?? LogLevel.Debug,
      levels: LEVELS,
      transports: [transport],
      exceptionHandlers: [transport],
      rejectionHandlers: [transport],
    });
  }

  log(level: LogLevel, message: string, data?: LogData): void {
    this.logger.log(level, message, { context: this.context, ...data });
  }

  error(message: string | Error, data?: LogData): void {
    const text = message instanceof Error ? message.message : message;
    const err = message instanceof Error ? message : data?.error;
    const { error: _error, ...rest } = data ?? {};
    this.logger.log(LogLevel.Error, text, {
      context: this.context,
      ...rest,
      stack: err instanceof Error ? err.stack : undefined,
    });
  }

  warn(message: string, data?: LogData): void {
    this.log(LogLevel.Warn, message, data);
  }

  info(message: string, data?: LogData): void {
    this.log(LogLevel.Info, message, data);
  }

  debug(message: string, data?: LogData): void {
    this.log(LogLevel.Debug, message, data);
  }

  verbose(message: string, data?: LogData): void {
    this.log(LogLevel.Verbose, message, data);
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
