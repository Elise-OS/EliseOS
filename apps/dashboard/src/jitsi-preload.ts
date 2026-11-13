let scriptPromise: Promise<void> | undefined;
let scriptOrigin: string | undefined;

/** Load Jitsi as soon as the screen snapshot reveals its private URL. */
export function preloadJitsiScript(baseUrl: string): Promise<void> {
  const origin = new URL(baseUrl).origin;
  if (scriptPromise && scriptOrigin === origin) return scriptPromise;
  scriptOrigin = origin;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${origin}/external_api.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = undefined;
      scriptOrigin = undefined;
      reject(new Error('Jitsi script unavailable'));
    };
    document.head.append(script);
  });
  return scriptPromise;
}
