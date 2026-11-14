/**
 * Lets the worker sleep until either something asks for attention or a timeout elapses.
 * A notification received while the worker is busy is remembered for the next wait.
 */
export function createWakeSignal() {
  let pending = false;
  let wake: (() => void) | null = null;
  return {
    notify(): void {
      pending = true;
      wake?.();
    },
    async wait(timeoutMs: number): Promise<void> {
      if (!pending) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, timeoutMs);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wake = null;
      }
      pending = false;
    },
  };
}
