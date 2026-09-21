// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarPage } from './CalendarPage';

describe('Shared calendar web page', () => {
  let root: Root;
  let host: HTMLDivElement;
  let requests: Array<{ url: string; method: string; body: string | undefined }>;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    requests = [];
    vi.stubGlobal(
      'EventSource',
      class {
        close() {}
      },
    );
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        requests.push({
          url,
          method: init?.method ?? 'GET',
          body: init?.body as string | undefined,
        });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: [], timezone: 'Europe/Paris', canWrite: true }),
        });
      }),
    );
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });
  it('shows the empty state and opens the event form', async () => {
    await act(async () => {
      root.render(<CalendarPage onBack={() => undefined} />);
      await Promise.resolve();
    });
    act(() => {
      (
        Array.from(host.querySelectorAll('button')).find(
          (button) => button.textContent === 'Liste',
        ) as HTMLButtonElement
      ).click();
    });
    expect(host.textContent).toContain('Aucun rendez-vous prévu');
    act(() => {
      (
        Array.from(host.querySelectorAll('button')).find((button) =>
          button.textContent?.includes('Ajouter'),
        ) as HTMLButtonElement
      ).click();
    });
    expect(host.textContent).toContain('Ajouter au calendrier');
  });
  it('submits an appointment to the protected calendar endpoint', async () => {
    await act(async () => {
      root.render(<CalendarPage onBack={() => undefined} />);
      await Promise.resolve();
    });
    act(() => {
      (
        Array.from(host.querySelectorAll('button')).find((button) =>
          button.textContent?.includes('Ajouter'),
        ) as HTMLButtonElement
      ).click();
    });
    const inputs = Array.from(host.querySelectorAll('input'));
    const setValue = (element: HTMLInputElement, value: string) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!.call(
        element,
        value,
      );
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setValue(inputs[0]!, 'Médecin');
    setValue(inputs[1]!, '2026-09-24T10:30');
    await act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(
      requests.some((request) => request.method === 'POST' && request.url === '/api/v1/calendar'),
    ).toBe(true);
  });
});
