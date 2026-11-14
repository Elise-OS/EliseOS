// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxHealthPanel } from './BoxHealthPanel';
import { demoBoxHealthReport } from './demo/box-health';

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function render(fetchImpl: () => Promise<Response>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(fetchImpl));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      <BoxHealthPanel
        onOpenZigbee={() => undefined}
        onOpenSensors={() => undefined}
        onOpenRemoteAccess={() => undefined}
      />,
    ),
  );
  await act(async () => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
  });
  return container;
}

describe('BoxHealthPanel', () => {
  it('says « Impossible de vérifier » when the box does not answer, never « Tout va bien »', async () => {
    const container = await render(() => Promise.reject(new Error('offline')));
    expect(container.textContent).toContain('Impossible de vérifier');
    expect(container.textContent).not.toContain('Tout va bien');
    expect(container.querySelector('.box-health-verdict.is-unverifiable')).not.toBeNull();
  });

  it('shows the verdict, the rows and the raw values of the real report', async () => {
    const body = demoBoxHealthReport('warning', Date.now());
    const container = await render(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response),
    );
    expect(container.querySelector('.box-health-verdict.is-warning')).not.toBeNull();
    expect(container.textContent).toContain('Espace de stockage');
    expect(container.textContent).toContain('Impossible de savoir si la box ralentit');
    expect(container.querySelector('details.box-health-technical')?.textContent).toContain(
      'usedPercent',
    );
  });

  it('does not trust an answer it cannot read', async () => {
    const container = await render(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ verdict: 'ok', groups: 'none' }),
      } as Response),
    );
    expect(container.textContent).toContain('Impossible de vérifier');
    expect(container.textContent).not.toContain('Tout va bien');
  });
});
