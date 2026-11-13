import { expect, test, type Page } from '@playwright/test';
import { APP_URL, DEMO_URL } from '../playwright.config';

/** Fails the test on any uncaught error of the page. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const nav = (page: Page, index: number) => page.locator(`[data-tour-target="nav-${index}"]`);

test.describe('caregiver space (demo build)', () => {
  test('opens the home and every page loaded on demand', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(DEMO_URL);
    await expect(page.getByText('Bonjour Claire,')).toBeVisible();

    // TV display: ScreenPanel is its own chunk.
    await nav(page, 10).click();
    await expect(page.getByText('Écran et appels')).toBeVisible();

    // Home plan editor: HomePlanEditor is its own chunk.
    await nav(page, 3).click();
    await page.getByRole('button', { name: 'Modifier mon logement' }).click();
    await expect(page.getByText('Gérer mon logement')).toBeVisible();

    // Liaison book, then calendar: CalendarPage is its own chunk.
    await nav(page, 11).click();
    await page.getByRole('button', { name: 'Calendrier' }).click();
    await expect(page.getByText('Calendrier partagé')).toBeVisible();

    // Settings, Zigbee key tab: ZigbeeKeyPanel is its own chunk.
    await nav(page, 8).click();
    await page.getByRole('button', { name: 'Clé Zigbee', exact: true }).click();
    await expect(page.locator('main')).not.toContainText('Chargement');

    expect(errors).toEqual([]);
  });

  test('switches the interface language', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(DEMO_URL);
    await nav(page, 8).click();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await expect(nav(page, 0)).toHaveText(/Home/);
    expect(errors).toEqual([]);
  });
});

test.describe('production build', () => {
  test('the resident TV loads its own screen, not the caregiver app', async ({ page }) => {
    const scripts: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname);
    });
    // No backend here: the TV keeps waiting for Élise, which is enough to check what loads.
    await page.route('**/api/**', (route) => route.fulfill({ status: 503, body: '{}' }));
    await page.goto(`${APP_URL}resident-screen`);
    await expect
      .poll(() => scripts.some((path) => /\/ResidentScreen-[\w-]+\.js$/.test(path)))
      .toBe(true);
    expect(scripts.filter((path) => /\/App-[\w-]+\.js$/.test(path))).toEqual([]);
  });

  test('the caregiver app shows the sign-in when no session is open', async ({ page }) => {
    const errors = watchErrors(page);
    await page.route('**/api/v1/auth/setup-state', (route) =>
      route.fulfill({ json: { setupRequired: false, systemReady: true } }),
    );
    await page.route('**/api/v1/auth/login-options', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/**', (route, request) =>
      request.url().includes('/auth/setup-state') || request.url().includes('/auth/login-options')
        ? route.fallback()
        : route.fulfill({ status: 401, json: { message: 'Unauthorized' } }),
    );
    await page.goto(APP_URL);
    await expect(page.locator('input[type="password"]')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
