import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ScreenPanel } from './ScreenPanel';
import { ResidentScreen } from './ResidentScreen';
import './styles.css';

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
