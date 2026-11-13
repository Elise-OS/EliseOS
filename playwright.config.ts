import { defineConfig, devices } from '@playwright/test';

// Browser checks of the caregiver dashboard, without a backend:
// - the public demo build (real app on its in-memory API) for navigation through the pages;
// - the production build, to keep each address loading only its own screen.
const DEMO_PORT = 4180;
const APP_PORT = 4181;
const demoOutDir = 'e2e-dist/demo';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { trace: 'retain-on-failure', locale: 'fr-FR', timezoneId: 'Europe/Paris' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `pnpm --filter @elise/dashboard exec vite build --mode demo && pnpm --filter @elise/dashboard exec vite preview --mode demo --port ${DEMO_PORT} --strictPort`,
      env: { ELISE_DEMO_OUT_DIR: `${process.cwd()}/${demoOutDir}` },
      url: `http://localhost:${DEMO_PORT}/demo/`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      // Serves apps/dashboard/dist: run `pnpm build` (or the dashboard build) first.
      command: `pnpm --filter @elise/dashboard exec vite preview --port ${APP_PORT} --strictPort`,
      url: `http://localhost:${APP_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});

export const DEMO_URL = `http://localhost:${DEMO_PORT}/demo/`;
export const APP_URL = `http://localhost:${APP_PORT}/`;
