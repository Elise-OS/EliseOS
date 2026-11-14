// Entry of the public demo: install the in-memory API and frozen clock before the app loads.
import './start-clock';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import { currentLanguage, loadLanguage } from '../i18n';

// The texts of the visitor's language come first: the scenario and the app read them on load.
void loadLanguage(currentLanguage()).then(async () => {
  await import('./install');
  const { DemoRoot } = await import('./DemoRoot');
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <DemoRoot />
    </StrictMode>,
  );
});
