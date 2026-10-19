// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertsPage } from './AlertsPage';

const roots: Root[] = [];

describe('page Alertes', () => {
  it('shows the requested layout without claiming no emergency before the server responds', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        return Promise.resolve(
          url === '/api/v1/alerts/summary'
            ? ({ ok: false } as Response)
            : ({
                ok: true,
                json: () => Promise.resolve({ items: [], nextCursor: null }),
              } as Response),
        );
      }),
    );
    vi.stubGlobal(
      'EventSource',
      class {
        onmessage: ((event: MessageEvent) => void) | null = null;
        close() {}
      },
    );

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    act(() =>
      root.render(
        <AlertsPage
          locale="fr"
          canManage
          residentName="Élise"
          timezone="Europe/Paris"
          onSettings={() => undefined}
          onCall={() => Promise.resolve()}
          onChanged={() => Promise.resolve()}
        />,
      ),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('ALERTES DU DOMICILE');
    expect(container.textContent).toContain('Situations récentes et en cours');
    expect(container.textContent).toContain('Règles des alertes');
    expect(container.textContent).toContain('État des urgences indisponible');
    expect(container.textContent).not.toContain('Aucune urgence en cours');
  });
});

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
