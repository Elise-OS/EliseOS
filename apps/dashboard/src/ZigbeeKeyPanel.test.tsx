// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createZigbeeDemo, type ZigbeeDemoScenario, type ZigbeeStatus } from '@elise/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZigbeeKeyPanel } from './ZigbeeKeyPanel';

type Answer = { status: number; body?: unknown };

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

/** The in-memory demo key plays the box; `override` lets a test break one channel of the search. */
async function render(
  scenario: ZigbeeDemoScenario,
  override?: (path: string, body: { network?: boolean }, answer: Answer) => Answer,
) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const demo = createZigbeeDemo({ scenario });
  const searches: boolean[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://box').pathname.replace('/api/v1', '');
      const raw = typeof init?.body === 'string' ? init.body : undefined;
      const body = raw ? (JSON.parse(raw) as { network?: boolean }) : {};
      if (path.endsWith('/scan')) searches.push(body.network === true);
      const answer = demo.handle(init?.method ?? 'GET', path, raw) ?? {
        status: 404,
      };
      const final = override ? override(path, body, answer) : answer;
      return Promise.resolve(
        new Response(JSON.stringify(final.body ?? null), {
          status: final.status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(() => {
    root?.render(<ZigbeeKeyPanel />);
    return Promise.resolve();
  });
  await act(() => Promise.resolve());
  return { host, searches };
}

const press = async (host: HTMLElement, label: string) => {
  const button = Array.from(host.querySelectorAll('button')).find((item) =>
    item.textContent?.includes(label),
  );
  expect(button, label).toBeTruthy();
  await act(() => {
    button?.click();
    return Promise.resolve();
  });
  await act(() => Promise.resolve());
};

describe('searching for a Zigbee key', () => {
  it('has a single search button instead of a detect button and a network button', async () => {
    const { host } = await render('ready');
    const labels = Array.from(host.querySelectorAll('.zk-hero-search')).map((button) =>
      button.textContent?.trim(),
    );
    expect(labels).toEqual(['Chercher une clé']);
    expect(host.textContent).not.toContain('Détecter');
    expect(host.textContent).not.toContain('Chercher une clé réseau');
  });

  it('lists the key plugged on the box and the key on the home network together', async () => {
    const { host, searches } = await render('ready');
    expect(host.querySelectorAll('[data-testid="zigbee-candidate"]')).toHaveLength(0);
    await press(host, 'Chercher une clé');
    expect(searches).toEqual([true]);
    const cards = Array.from(host.querySelectorAll('[data-testid="zigbee-candidate"]'));
    expect(cards).toHaveLength(2);
    const text = cards.map((card) => card.textContent ?? '').join('\n');
    expect(text).toContain('Branchée sur la box');
    expect(text).toContain('Sur le réseau de la maison');
    expect(text).toContain('192.168.1.50:6638');
    expect(text).toContain('SMLIGHT SLZB-06M');
    expect(host.textContent).not.toContain('n’a pas abouti');
  });

  it('keeps the plugged keys and says so when the network search fails', async () => {
    const { host, searches } = await render('ready', (path, body, answer) => {
      if (!path.endsWith('/scan')) return answer;
      if (body.network) return { status: 503, body: { message: 'timeout' } };
      // The simulator knows the network key; this box cannot reach it.
      const status = answer.body as ZigbeeStatus;
      return {
        ...answer,
        body: { ...status, candidates: status.candidates.filter((item) => item.kind === 'usb') },
      };
    });
    await press(host, 'Chercher une clé');
    // The combined search broke: the box alone is searched right after.
    expect(searches).toEqual([true, false]);
    const cards = Array.from(host.querySelectorAll('[data-testid="zigbee-candidate"]'));
    expect(cards).toHaveLength(1);
    expect(cards[0]?.textContent).toContain('Branchée sur la box');
    expect(host.textContent).toContain('La recherche sur le réseau de la maison n’a pas abouti');
  });

  it('keeps the network key and says so when the box search fails', async () => {
    const { host } = await render('ready', (path, _body, answer) => {
      if (!path.endsWith('/scan')) return answer;
      const status = answer.body as ZigbeeStatus;
      return {
        ...answer,
        body: {
          ...status,
          candidates: status.candidates.filter((item) => item.kind === 'network'),
          scan: { usb: 'failed', network: 'ok' },
        },
      };
    });
    await press(host, 'Chercher une clé');
    const cards = Array.from(host.querySelectorAll('[data-testid="zigbee-candidate"]'));
    expect(cards).toHaveLength(1);
    expect(cards[0]?.textContent).toContain('Sur le réseau de la maison');
    expect(host.textContent).toContain('La recherche des clés branchées sur la box n’a pas abouti');
  });

  it('explains both possibilities when nothing is found', async () => {
    const { host } = await render('ready', (path, _body, answer) => {
      if (!path.endsWith('/scan')) return answer;
      const status = answer.body as ZigbeeStatus;
      return {
        ...answer,
        body: { ...status, candidates: status.candidates.filter((item) => item.isCurrent) },
      };
    });
    expect(host.textContent).not.toContain('Aucune autre clé trouvée');
    await press(host, 'Chercher une clé');
    const empty = host.querySelector('.zk-empty');
    expect(empty?.textContent).toContain('Aucune autre clé trouvée');
    expect(empty?.textContent).toContain('Branchée sur la box');
    expect(empty?.textContent).toContain('Sur le réseau de la maison');
    expect(empty?.textContent).toContain('(câble Ethernet ou Wi-Fi)');
    expect(empty?.textContent).toContain('Chercher à nouveau');
  });

  it('keeps the manual network address in the folded advanced mode', async () => {
    const { host } = await render('ready');
    const advanced = host.querySelector('details.zigbee-advanced') as HTMLDetailsElement;
    expect(advanced.open).toBe(false);
    expect(advanced.querySelector('input[placeholder="192.168.1.50:6638"]')).toBeTruthy();
  });

  it('shows the search going on, on the box and on the home network', async () => {
    const { host } = await render('ready');
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = globalThis.fetch as unknown as (
      url: string,
      init?: RequestInit,
    ) => Promise<Response>;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/scan')) await pending;
        return fetchMock(url, init);
      }),
    );
    await press(host, 'Chercher une clé');
    const progress = host.querySelector('.zk-search');
    expect(progress?.getAttribute('role')).toBe('status');
    expect(progress?.textContent).toContain('Prises USB de la box');
    expect(progress?.textContent).toContain('Réseau de la maison');
    await act(async () => {
      release();
      await pending;
    });
    await act(() => Promise.resolve());
    await act(() => Promise.resolve());
    expect(host.querySelector('.zk-search')).toBeNull();
    expect(host.querySelectorAll('[data-testid="zigbee-candidate"]')).toHaveLength(2);
  });

  it('says the keys were found, not plugged, when one of them is on the home network', async () => {
    const { host } = await render('ready');
    await press(host, 'Chercher une clé');
    expect(host.textContent).toContain('2 autres clés ont été trouvées');
    expect(host.textContent).not.toContain('sont branchées');
    expect(host.textContent).not.toContain('Une autre clé est branchée');
  });

  it('puts the icon beside the text on the actions of a key', async () => {
    const { host } = await render('ready');
    await press(host, 'Chercher une clé');
    const identify = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Identifier la clé'),
    );
    expect(identify?.className).toContain('zk-button');
    expect(identify?.querySelector('svg')).toBeTruthy();
  });
});
