import * as winston from "winston";
import { LogLevel } from "./logger.port";
import { WinstonLogger } from "./winston.logger";

type Entry = { level: string; message: string; context?: string; stack?: string };

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
});
