// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialScreenState } from '@michel/contracts';
import { ScreenPanel } from './ScreenPanel';

vi.mock('./screen-events', () => ({ subscribeScreenEvents: () => () => undefined }));

describe('TV message editor and calendar agenda summary', () => {
  let root: Root;
  let host: HTMLDivElement;
  let state: ReturnType<typeof initialScreenState>;
  let requests: Array<{ url: string; body: Record<string, unknown>; method: string }>;
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    requests = [];
    state = initialScreenState();
    state.message = 'Bonjour';
    state.messages = ['Bonjour'];
    const activeMediaId = 'd108520f-6129-4b1b-b69d-a838471667f9';
    state.media = [
      {
        id: activeMediaId,
        title: 'Concerts',
        kind: 'youtube',
        url: 'https://youtu.be/M7lc1UVf-VE',
      },
    ];
    state.playback.mediaId = activeMediaId;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const body: Record<string, unknown> =
          typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
        requests.push({ url, body, method: init?.method ?? 'GET' });
        const response = url.endsWith('/screen/upload')
          ? {
              state: {
                ...state,
                media: [
                  ...state.media,
                  {
                    id: '3b2c2950-6fe5-45f8-82a5-a28707113e53',
                    title: 'photo.jpg',
                    kind: 'photo',
                    url: '/api/v1/screen-media/home1/photo',
                  },
                ],
              },
            }
          : url.endsWith('/screen/tv-guide')
            ? { channels: [], retrievedAt: '2026-09-23T00:00:00.000Z', stale: false }
            : url.endsWith('/appointments') && init?.method === 'GET'
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
                  agenda: [
                    {
                      id: 'calendar-appointment',
                      type: 'appointment',
                      title: 'Coiffeur',
                      pictogram: 'hairdresser',
                      startsAt: '2026-09-23T10:00:00.000Z',
                    },
                    {
                      id: 'calendar-visit',
                      type: 'visit',
                      title: 'Sophie',
                      startsAt: '2026-09-23T13:00:00.000Z',
                    },
                  ],
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
        return { ok: true, json: () => Promise.resolve(response) };
      }),
    );
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<ScreenPanel />);
      await Promise.resolve();
    });
  });
  afterEach(() => {
    act(() => root.unmount());
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
      await Promise.resolve();
    });
  };
  it('adds, edits and publishes several messages with a timer', async () => {
    await act(async () => {
      button('+ Ajouter un message').click();
      await Promise.resolve();
    });
    await change(
      host.querySelector<HTMLTextAreaElement>('.screen-message-input textarea')!,
      'Paul vient demain ❤️',
    );
    await change(host.querySelector<HTMLInputElement>('.screen-message-timing input')!, '15');
    await act(async () => {
      button('Afficher sur la TV').click();
      await Promise.resolve();
    });
    expect(requests.find((row) => row.url.endsWith('/screen/message'))?.body).toEqual({
      messages: ['Bonjour', 'Paul vient demain ❤️'],
      messageIntervalSeconds: 15,
    });
    await act(async () => {
      button('Retirer ce message').click();
      await Promise.resolve();
    });
    expect(host.querySelector<HTMLTextAreaElement>('.screen-message-input textarea')!.value).toBe(
      'Bonjour',
    );
  });
  it('fills a favorite message and schedules it for later', async () => {
    const favorite = Array.from(host.querySelectorAll('button')).find((element) =>
      element.textContent?.includes('Bonne journée'),
    )!;
    await act(async () => {
      favorite.click();
      await Promise.resolve();
    });
    expect(host.querySelector<HTMLTextAreaElement>('.screen-message-input textarea')!.value).toBe(
      'Bonne journée ! On pense fort à toi ❤️',
    );
    await change(
      host.querySelector<HTMLInputElement>('.screen-schedule-control input')!,
      '2099-10-01T10:00',
    );
    await act(async () => {
      button('Programmer le message').click();
      await Promise.resolve();
    });
    expect(
      requests.find((row) => row.url.endsWith('/screen/scheduled-content') && row.method === 'POST')
        ?.body,
    ).toMatchObject({
      kind: 'message',
      messages: ['Bonne journée ! On pense fort à toi ❤️'],
      messageIntervalSeconds: 20,
    });
  });
  it('shows a read-only recap of the same calendar agenda that appears on the TV', () => {
    expect(host.textContent).toContain('Rendez-vous du jour');
    expect(host.textContent).toContain('Coiffeur');
    expect(host.textContent).toContain('Sophie');
    expect(host.querySelector('.screen-appointment-form')).toBeNull();
    expect(requests.some((row) => row.url.endsWith('/screen/appointments'))).toBe(false);
  });

  it('keeps the current media and sound controls in the bar above the main tabs', async () => {
    const tabs = host.querySelectorAll('.screen-main-tabs [role="tab"]');
    expect(tabs).toHaveLength(4);
    expect(host.querySelector('.screen-playback-now')?.textContent).toContain('Concerts');
    expect(host.querySelector('.screen-playback-now input[type="range"]')).not.toBeNull();
    expect(host.querySelector('.screen-medias-player')).toBeNull();
    expect(host.textContent).not.toContain('Météo sur la TV');

    await act(async () => {
      host.querySelector<HTMLButtonElement>('#screen-main-tab-medias')!.click();
      await Promise.resolve();
    });
    expect(host.querySelector('#screen-main-panel-medias')?.hasAttribute('hidden')).toBe(false);
    expect(host.querySelector('.screen-playback-now')?.textContent).toContain('Concerts');

    await act(async () => {
      host.querySelector<HTMLButtonElement>('#screen-main-tab-messages')!.click();
      await Promise.resolve();
    });
    expect(host.querySelector('#screen-main-panel-messages')?.hasAttribute('hidden')).toBe(false);
    expect(host.querySelector('.screen-playback-now')?.textContent).toContain('Concerts');
  });

  it('adds an album photo when its optional comment is left blank', async () => {
    await act(async () => {
      host.querySelector<HTMLButtonElement>('#screen-main-tab-album')!.click();
      await Promise.resolve();
    });
    const fileInput = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })],
    });
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(button('Ajouter à l’album').disabled).toBe(false);

    await act(async () => {
      button('Ajouter à l’album').click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(requests.find((row) => row.url.endsWith('/screen/media'))?.body.title).toBe('');
  });
});
