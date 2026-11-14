/**
 * One realtime connection for the whole tab. Every screen used to open its own
 * `EventSource` on /api/v1/events; they now share a single one, opened with the first
 * subscriber and closed with the last.
 */
export type RealtimeListener = (data: string) => void;

const EVENTS_URL = '/api/v1/events';
const listeners = new Set<RealtimeListener>();
let stream: EventSource | null = null;
let connected = false;

function open(): void {
  const source = new EventSource(EVENTS_URL);
  stream = source;
  connected = false;
  source.onmessage = (event: MessageEvent) => {
    const data = String(event.data);
    if (!connected) connected = true;
    // A listener may unsubscribe while it is being called.
    for (const listener of [...listeners]) listener(data);
  };
}

/**
 * Receives the raw data of every realtime event until the returned function is called.
 * A screen that joins an already open connection is told "connected" right away, exactly
 * as if it had opened the connection itself.
 */
export function subscribeRealtime(listener: RealtimeListener): () => void {
  listeners.add(listener);
  if (!stream) open();
  else if (connected) {
    queueMicrotask(() => {
      if (listeners.has(listener)) listener(JSON.stringify({ type: 'connected' }));
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stream) {
      stream.close();
      stream = null;
      connected = false;
    }
  };
}
