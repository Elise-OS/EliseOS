import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { currentLanguage, loadLanguage } from './i18n';
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

// Each address loads only its own screen: the TV of the resident never downloads the
// caregiver app, and the caregiver app never downloads the TV.
const App = lazy(() => import('./App').then((module) => ({ default: module.App })));
const ScreenPanel = lazy(() =>
  import('./ScreenPanel').then((module) => ({ default: module.ScreenPanel })),
);
const ResidentScreen = lazy(() =>
  import('./ResidentScreen').then((module) => ({ default: module.ResidentScreen })),
);

// Only the catalog of the language of this device is downloaded, before the first screen.
void loadLanguage(currentLanguage()).then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Suspense fallback={null}>
        {location.pathname === '/resident-screen' ? (
          <ResidentScreen />
        ) : location.pathname === '/screen-control' ? (
          <ScreenPanel />
        ) : (
          <App />
        )}
      </Suspense>
    </StrictMode>,
  ),
);
