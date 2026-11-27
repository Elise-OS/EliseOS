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
    await nav(page, 8).evaluate((button) => (button as HTMLButtonElement).click());
    await page.getByRole('button', { name: 'Clé Zigbee', exact: true }).click();
    await expect(page.locator('main')).not.toContainText('Chargement');

    expect(errors).toEqual([]);
  });

  test('gives the heatwave mode its own « Canicule » settings tab', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`${DEMO_URL}?canicule=on`);
    await nav(page, 8).evaluate((button) => (button as HTMLButtonElement).click());
    // The general tab no longer carries the heatwave card.
    await expect(page.locator('.settings-page')).toBeVisible();
    await expect(page.locator('.heatwave-panel')).toHaveCount(0);
    await page.getByRole('button', { name: 'Canicule', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Le mode canicule est activé' })).toBeVisible();
    await expect(page.getByText('Comment ça marche')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Vos réglages' })).toBeVisible();
    await page.getByRole('button', { name: 'Modifier les réglages' }).first().click();
    await expect(page.getByRole('dialog')).toContainText('Réglages du mode canicule');
    expect(errors).toEqual([]);
  });

  test('switches the interface language', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(DEMO_URL);
    await nav(page, 8).evaluate((button) => (button as HTMLButtonElement).click());
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await expect(nav(page, 0)).toHaveText(/Home/);
    expect(errors).toEqual([]);
  });
});

test.describe('production build', () => {
  const mockSignedInDashboard = async (page: import('@playwright/test').Page, role: string) => {
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/auth/setup-state') {
        return route.fulfill({ json: { setupRequired: false, systemReady: true } });
      }
      if (path === '/api/v1/overview') {
        return route.fulfill({
          json: {
            onboardingRequired: false,
            currentUser: { id: 'test-user', displayName: 'Camille Test', firstName: 'Camille' },
            home: { id: 'test-home', name: 'Maison test', type: 'HOUSE', resident: 'Louise' },
            resident: null,
            openAlerts: 0,
            sensors: { total: 0, online: 0, degraded: 0, offline: 0 },
            rooms: [],
            activity: [],
          },
        });
      }
      if (path === '/api/v1/auth/me') {
        return route.fulfill({
          json: {
            id: 'test-user',
            displayName: 'Camille Test',
            firstName: 'Camille',
            role,
            capabilities: role === 'ADMINISTRATOR' ? ['configuration:manage'] : [],
            mustChangePassword: false,
          },
        });
      }
      if (path === '/api/v1/household') {
        return route.fulfill({
          json: {
            home: {
              id: 'test-home',
              name: 'Maison test',
              timezone: 'Europe/Paris',
              type: 'HOUSE',
              address: null,
              floorCount: 1,
              installationStatus: 'READY',
              learningStartedAt: null,
            },
            residents: [],
            trustedContacts: [],
            rooms: [],
            unassignedSensors: [],
          },
        });
      }
      if (path === '/api/v1/system/box-health') {
        return route.fulfill({ status: 503, json: { message: 'Agent indisponible' } });
      }
      if (path === '/api/v1/screen' || path === '/api/v1/home-summary') {
        return route.fulfill({ status: 503, json: { message: 'Unavailable in this access test' } });
      }
      if (path === '/api/v1/remote-access/status') {
        return route.fulfill({ status: 503, json: { message: 'Unavailable in this access test' } });
      }
      if (path === '/api/v1/system/update' || path === '/api/v1/system/update/check') {
        return route.fulfill({ json: {} });
      }
      return route.fulfill({ json: [] });
    });
  };

  test('shows the box health tab to an administrator and an unreadable state when opened', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await mockSignedInDashboard(page, 'ADMINISTRATOR');
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.addInitScript(() => window.localStorage.setItem('elise_sidebar_auto_hide', 'false'));
    const accessLoaded = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/auth/me'),
    );
    await page.goto(APP_URL);
    await accessLoaded;
    await page.waitForTimeout(250);
    await expect(nav(page, 8)).toBeVisible();
    await nav(page, 8).click({ force: true });
    await expect(page.locator('.settings-page')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Santé de la box', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Santé de la box', exact: true }).click();
    await expect(page.getByText('Impossible de vérifier').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('hides the box health tab from a caregiver without configuration access', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await mockSignedInDashboard(page, 'CAREGIVER');
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.addInitScript(() => window.localStorage.setItem('elise_sidebar_auto_hide', 'false'));
    const accessLoaded = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/auth/me'),
    );
    await page.goto(APP_URL);
    await accessLoaded;
    await page.waitForTimeout(250);
    await expect(nav(page, 8)).toBeVisible();
    await nav(page, 8).click({ force: true });
    await expect(page.locator('.settings-page')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Santé de la box', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

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
