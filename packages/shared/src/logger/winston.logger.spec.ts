import * as winston from "winston";
import { runWithRequestContext } from "../observability/request-context";
import { LogLevel } from "./logger.port";
import {
  WinstonLogger,
  handleFatalProcessError,
  resolveLogLevel,
  setProcessErrorRecorder,
} from "./winston.logger";

type Entry = {
  level: string;
  message: string;
  context?: string;
  stack?: string;
  correlationId?: string;
};

function capture(logger: WinstonLogger): Entry[] {
  const entries: Entry[] = [];
  const inner = (logger as unknown as { logger: winston.Logger }).logger;
  inner.clear();
  inner.add(
    new winston.transports.Stream({
      stream: new (require("stream").Writable)({
        write(chunk: Buffer, _enc: string, cb: () => void) {
          entries.push(JSON.parse(chunk.toString()) as Entry);
          cb();
        },
      }),
      format: winston.format.json(),
    }),
  );
  return entries;
}

describe("WinstonLogger", () => {
  const stderr = jest.spyOn(process.stderr, "write");

  afterEach(() => stderr.mockClear());

  it("maps every Nest LoggerService method to a valid winston level", () => {
    const logger = new WinstonLogger("Ctx", { pretty: false, level: LogLevel.Verbose });
    const entries = capture(logger);

    logger.log("hello", "NestCtx");
    logger.warn("careful", "NestCtx");
    logger.debug("dbg", "NestCtx");
    logger.verbose("verb", "NestCtx");
    logger.fatal("boom", "NestCtx");
    logger.error("bad", "at x\n    at y", "NestCtx");

    expect(entries.map((e) => e.level)).toEqual([
      "info",
      "warn",
      "debug",
      "verbose",
      "error",
      "error",
    ]);
    expect(entries.every((e) => e.context === "NestCtx")).toBe(true);
    expect(entries[5].stack).toContain("at y");
    expect(stderr).not.toHaveBeenCalledWith(
      expect.stringContaining("Unknown logger level"),
    );
  });

  it("keeps the (level, message, data) form and falls back to own context", () => {
    const logger = new WinstonLogger("Ctx", { pretty: false });
    const entries = capture(logger);

    logger.log("warn" as never, "legacy");
    logger.error(new Error("oops"));

    expect(entries[0]).toMatchObject({ level: "warn", message: "legacy", context: "Ctx" });
    expect(entries[1]).toMatchObject({ level: "error", message: "oops" });
    expect(entries[1].stack).toBeDefined();
  });

  it("registers process exception handlers once, not per instance", () => {
    const before = process.listenerCount("uncaughtException");
    for (let i = 0; i < 20; i++) new WinstonLogger(`C${i}`, { pretty: false });
    expect(process.listenerCount("uncaughtException") - before).toBeLessThanOrEqual(1);
    expect(process.listenerCount("uncaughtException")).toBeLessThanOrEqual(10);
  });

  it("fills correlationId from the request context unless one is passed", () => {
    const logger = new WinstonLogger("Ctx", { pretty: false });
    const entries = capture(logger);

    logger.info("outside");
    runWithRequestContext("req-1", () => {
      logger.info("inside");
      logger.warn("nest form", "NestCtx");
      logger.info("explicit", { correlationId: "given" });
    });

    expect(entries[0].correlationId).toBeUndefined();
    expect(entries.slice(1).map((e) => e.correlationId)).toEqual([
      "req-1",
      "req-1",
      "given",
    ]);
  });
});

describe("resolveLogLevel", () => {
  it.each<[Record<string, string>, LogLevel, string | undefined]>([
    [{}, LogLevel.Debug, undefined],
    [{ NODE_ENV: "production" }, LogLevel.Info, undefined],
    [{ LOG_LEVEL: "warn", NODE_ENV: "production" }, LogLevel.Warn, undefined],
    [{ LOG_LEVEL: " ERROR " }, LogLevel.Error, undefined],
    [{ LOG_LEVEL: "loud", NODE_ENV: "production" }, LogLevel.Info, "loud"],
    [{ LOG_LEVEL: "loud" }, LogLevel.Debug, "loud"],
  ])("%j -> %s", (env, level, invalid) => {
    expect(resolveLogLevel(env)).toEqual(invalid ? { level, invalid } : { level });
  });

  it("applies LOG_LEVEL and warns once per process about an invalid value", () => {
    const saved = { LOG_LEVEL: process.env.LOG_LEVEL, NODE_ENV: process.env.NODE_ENV };
    process.env.LOG_LEVEL = "loud";
    process.env.NODE_ENV = "production";
    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const w = require("winston") as typeof winston;
        const seen: { level: string; message: string }[] = [];
        const spy = jest
          .spyOn(w.transports.Console.prototype, "log")
          .mockImplementation((...args: unknown[]) => {
            seen.push(args[0] as { level: string; message: string });
            (args[1] as (() => void) | undefined)?.();
          });
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require("./winston.logger") as typeof import("./winston.logger");
        const a = new mod.WinstonLogger("A", { pretty: false });
        new mod.WinstonLogger("B", { pretty: false });
        a.debug("hidden");
        a.info("shown");

        expect(seen.filter((e) => e.message.includes("Invalid LOG_LEVEL"))).toHaveLength(1);
        expect(seen.map((e) => e.message)).toContain("shown");
        expect(seen.map((e) => e.message)).not.toContain("hidden");
        spy.mockRestore();
      });
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe("process error handling", () => {
  let stderr: jest.SpyInstance;
  let lines: string[];

  beforeEach(() => {
    lines = [];
    stderr = jest
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        lines.push(chunk.toString());
        return true;
      });
  });

  afterEach(() => {
    stderr.mockRestore();
    setProcessErrorRecorder(undefined);
  });

  it("logs one JSON line with stack and request id, records it and exits 1", () => {
    const exit = jest.fn();
    const recorder = jest.fn();
    setProcessErrorRecorder(recorder);
    const error = new TypeError("kaboom");

    runWithRequestContext("req-9", () =>
      handleFatalProcessError("uncaughtException", error, exit),
    );

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      level: "error",
      message: "kaboom",
      context: "Process",
      event: "uncaughtException",
      errorType: "TypeError",
      correlationId: "req-9",
      stack: expect.stringContaining("kaboom"),
    });
    expect(recorder).toHaveBeenCalledWith(error);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("handles non-Error rejections and still exits when recording throws", () => {
    const exit = jest.fn();
    setProcessErrorRecorder(() => {
      throw new Error("metrics down");
    });

    handleFatalProcessError("unhandledRejection", { code: 7 }, exit);

    expect(JSON.parse(lines[0])).toMatchObject({
      message: '{"code":7}',
      event: "unhandledRejection",
      errorType: "NonError",
    });
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("routes process events through the single handler", () => {
    const exit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const beforeExc = process.listeners("uncaughtException");
    const beforeRej = process.listeners("unhandledRejection");
    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require("./winston.logger") as typeof import("./winston.logger");
        new mod.WinstonLogger("X", { pretty: false });
        new mod.WinstonLogger("Y", { pretty: false });
      });
      const exc = process.listeners("uncaughtException").filter((l) => !beforeExc.includes(l));
      const rej = process.listeners("unhandledRejection").filter((l) => !beforeRej.includes(l));
      expect(exc).toHaveLength(1);
      expect(rej).toHaveLength(1);

      exc[0](new Error("sync"), "uncaughtException");
      (rej[0] as (reason: unknown) => void)("async");

      expect(lines.map((l) => JSON.parse(l).event)).toEqual([
        "uncaughtException",
        "unhandledRejection",
      ]);
      expect(exit).toHaveBeenCalledTimes(2);
      exc.forEach((l) => process.removeListener("uncaughtException", l));
      rej.forEach((l) => process.removeListener("unhandledRejection", l));
    } finally {
      exit.mockRestore();
    }
  });
});
