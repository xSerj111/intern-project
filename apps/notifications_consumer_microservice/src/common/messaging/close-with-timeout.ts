import type { Logger } from '@nestjs/common';

/**
 * Awaits `close()` for at most `timeoutMs` and never throws: a channel close
 * can stay pending forever once the connection is gone, and must not hang or
 * fail the shutdown.
 */
export async function closeWithTimeout(
  close: () => Promise<unknown>,
  timeoutMs: number,
  logger: Logger,
  what: string,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      logger.warn(`Timed out closing ${what}`);
      resolve();
    }, timeoutMs);
  });
  try {
    await Promise.race([close(), timeout]);
  } catch (err) {
    logger.warn(`Failed to close ${what}: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
