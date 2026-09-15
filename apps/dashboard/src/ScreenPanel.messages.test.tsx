// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialScreenState } from '@michel/contracts';
import { ScreenPanel } from './ScreenPanel';

vi.mock('./screen-events', () => ({ subscribeScreenEvents: () => () => undefined }));

describe('TV message and appointment editor', () => {
  let root: Root;
  let host: HTMLDivElement;
  let requests: Array<{ url: string; body: Record<string, unknown>; method: string }>;
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    requests = [];
    const state = initialScreenState();
    state.message = 'Bonjour';
    state.messages = ['Bonjour'];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        requests.push({ url, body, method: init?.method ?? 'GET' });
        const response =
          url.endsWith('/appointments') && init?.method === 'GET'
            ? [
                {
                  id: 'appointment1',
                  title: 'Coiffeur',
                  startsAt: '2026-10-01T10:00:00Z',
                  pictogram: 'calendar',
                },
              ]
            : {
                state,
                resident: 'Michel',
                online: true,
                paired: true,
                capabilities: {},
                agenda: [],
                weather: null,
                timezone: 'Europe/Paris',
                grant: {
                  call: false,
                  autoAnswer: false,
                  message: true,
                  control: true,
                  administer: false,
                },
              };
        return { ok: true, json: async () => response };
      }),
    );
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<ScreenPanel />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
  const button = (label: string) =>
    Array.from(host.querySelectorAll('button')).find((el) => el.textContent?.trim() === label)!;
  const change = async (
    el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    value: string,
  ) => {
    await act(async () => {
      const prototype =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : el instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(el, value);
      el.dispatchEvent(
        new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
      );
    });
  };
  it('adds, edits and publishes several messages with a timer', async () => {
    await act(async () => button('+ Ajouter un message').click());
    await change(
      host.querySelector<HTMLTextAreaElement>('.screen-message-input textarea')!,
      'Paul vient demain ❤️',
    );
    await change(host.querySelector<HTMLInputElement>('.screen-message-timing input')!, '15');
    await act(async () => button('Afficher sur la TV').click());
    expect(requests.find((row) => row.url.endsWith('/screen/message'))?.body).toEqual({
      messages: ['Bonjour', 'Paul vient demain ❤️'],
      messageIntervalSeconds: 15,
    });
    await act(async () => button('Retirer ce message').click());
    expect(host.querySelector<HTMLTextAreaElement>('.screen-message-input textarea')!.value).toBe(
      'Bonjour',
    );
  });
  it('allows changing the pictogram of an existing appointment', async () => {
    await change(
      host.querySelector<HTMLSelectElement>('select[aria-label="Pictogramme pour Coiffeur"]')!,
      'hairdresser',
    );
    expect(requests.find((row) => row.url.endsWith('/appointments/appointment1'))).toMatchObject({
      method: 'PATCH',
      body: { pictogram: 'hairdresser' },
    });
  });
});
