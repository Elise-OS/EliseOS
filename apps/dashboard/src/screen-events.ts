/** Header-authenticated SSE for the limited resident device identity. */
export function subscribeScreenEvents(
  path: string,
  onUpdate: () => void,
  token?: string,
): () => void {
  const controller = new AbortController();
  void (async () => {
    try {
      const response = await fetch(`/api/v1/${path}`, {
        headers: { accept: 'text/event-stream', ...(token ? { 'x-screen-token': token } : {}) },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      while (!controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let index;
        while ((index = pending.indexOf('\n\n')) >= 0) {
          const event = pending.slice(0, index);
          pending = pending.slice(index + 2);
          if (event.includes('data:')) onUpdate();
        }
      }
    } catch {
      /* Periodic refresh remains available after a dropped stream. */
    }
  })();
  return () => controller.abort();
}
