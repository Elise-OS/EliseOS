let scriptPromise: Promise<void> | undefined;
let scriptOrigin: string | undefined;

/** Load Jitsi as soon as the screen snapshot reveals its private URL. */
export function preloadJitsiScript(baseUrl: string, timeoutMs = 15_000): Promise<void> {
  const origin = new URL(baseUrl).origin;
  const jitsiWindow = window as Window & { JitsiMeetExternalAPI?: unknown };
  if (jitsiWindow.JitsiMeetExternalAPI) return Promise.resolve();
  if (scriptPromise && scriptOrigin === origin) return scriptPromise;
  scriptOrigin = origin;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${origin}/external_api.js`;
    script.async = true;
    const timer = window.setTimeout(() => fail(), timeoutMs);
    const fail = () => {
      window.clearTimeout(timer);
      script.remove();
      scriptPromise = undefined;
      scriptOrigin = undefined;
      reject(new Error('Jitsi script unavailable'));
    };
    script.onload = () => {
      window.clearTimeout(timer);
      if (jitsiWindow.JitsiMeetExternalAPI) resolve();
      else fail();
    };
    script.onerror = fail;
    document.head.append(script);
  });
  return scriptPromise;
}
