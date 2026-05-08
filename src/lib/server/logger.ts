/**
 * Tiny structured logger.
 *
 * Emits one JSON line per event to stdout. Cheap, no deps. Good enough to
 * grep in `vercel logs`, `flyctl logs`, or `journalctl`. Replace with a
 * real logger (pino, winston) only when we have an actual reason to.
 *
 * Conventions:
 *   - `event` is a short snake_case verb describing what happened.
 *   - `props` is a flat-ish object of safe-to-log values.
 *   - Never log API keys, raw request bodies, or full provider responses.
 */

export type LogEventProps = Record<string, unknown>;

export function logEvent(event: string, props: LogEventProps = {}): void {
  const line = {
    ts: new Date().toISOString(),
    event,
    ...props,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}

export function logError(event: string, err: unknown, props: LogEventProps = {}): void {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "Unknown";
  logEvent(event, { ...props, error_name: name, error_message: message });
}
