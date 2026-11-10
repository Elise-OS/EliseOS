import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ScreenPanel } from './ScreenPanel';
import { ResidentScreen } from './ResidentScreen';
import { uiLocale } from './screen-locale';
import './styles.css';

// Élise answers in the language chosen on this device.
const baseFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href, window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/'))
    return baseFetch(input, init);
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  headers.set('x-elise-locale', uiLocale());
  return baseFetch(input, { ...init, headers });
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.pathname === '/resident-screen' ? (
      <ResidentScreen />
    ) : location.pathname === '/screen-control' ? (
      <ScreenPanel />
    ) : (
      <App />
    )}
  </StrictMode>,
);
