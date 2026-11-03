// Entry of the public demo: install the in-memory API and frozen clock before the app loads.
import './start-clock';
import './install';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import { DemoRoot } from './DemoRoot';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DemoRoot />
  </StrictMode>,
);
