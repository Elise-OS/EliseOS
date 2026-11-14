import pg from 'pg';

export const OUTBOX_CHANNEL = 'elise_outbox';

/**
 * Keeps one dedicated connection listening for new outbox rows, so a push notification
 * leaves as soon as it is queued. The periodic poll remains the safety net: losing this
 * connection only brings the worker back to its one-second polling.
 */
export function listenForOutbox(connectionString: string | undefined, onMessage: () => void) {
  let stopped = false;
  let client: pg.Client | null = null;
  let retry: NodeJS.Timeout | null = null;

  const reconnect = (): void => {
    if (stopped || retry) return;
    retry = setTimeout(() => {
      retry = null;
      void connect();
    }, 5_000);
  };

  const connect = async (): Promise<void> => {
    const next = new pg.Client({ connectionString });
    client = next;
    next.on('notification', onMessage);
    next.on('error', () => {
      next.end().catch(() => undefined);
      reconnect();
    });
    next.on('end', reconnect);
    try {
      await next.connect();
      await next.query(`LISTEN ${OUTBOX_CHANNEL}`);
      // Rows queued while the connection was down are picked up right away.
      onMessage();
    } catch {
      next.end().catch(() => undefined);
      reconnect();
    }
  };

  void connect();
  return {
    async close(): Promise<void> {
      stopped = true;
      if (retry) clearTimeout(retry);
      await client?.end().catch(() => undefined);
    },
  };
}
