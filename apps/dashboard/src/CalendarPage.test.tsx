// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarPage } from './CalendarPage';

describe('Shared calendar web page', () => {
  let root: Root;
  let host: HTMLDivElement;
  let requests: Array<{ url: string; method: string; body: string | undefined }>;
  let calendarItems: unknown[];
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    requests = [];
    calendarItems = [];
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
          json: () =>
            Promise.resolve({ items: calendarItems, timezone: 'Europe/Paris', canWrite: true }),
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
    expect(host.textContent).toContain('Ajouter un rendez-vous');
  });
  it('opens a new appointment on the selected calendar day', async () => {
    await act(async () => {
      root.render(<CalendarPage onBack={() => undefined} />);
      await Promise.resolve();
    });
    const now = new Date();
    const selectedDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const day = host.querySelector<HTMLElement>(`[data-calendar-day="${selectedDay}"]`);
    expect(day).not.toBeNull();
    act(() => day!.click());
    expect(host.querySelector<HTMLInputElement>('input[type="datetime-local"]')?.value).toMatch(
      new RegExp(`^${selectedDay}`),
    );
    expect(host.textContent).not.toContain('Visite familiale');
    expect(host.textContent).not.toContain('Lieu');
    expect(host.textContent).not.toContain('Notes');
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
  it('can edit and delete an existing appointment from its modal', async () => {
    const startsAt = new Date();
    startsAt.setDate(15);
    startsAt.setHours(10, 30, 0, 0);
    calendarItems = [
      {
        id: 'appointment-1',
        type: 'APPOINTMENT',
        title: 'Médecin',
        startsAt: startsAt.toISOString(),
        endsAt: null,
        detail: null,
        notes: null,
        seriesId: null,
        recurrence: 'NONE',
        recurrenceUntil: null,
      },
    ];
    await act(async () => {
      root.render(<CalendarPage onBack={() => undefined} />);
      await Promise.resolve();
    });
    act(() => (host.querySelector('.calendar-event') as HTMLButtonElement).click());
    expect(host.textContent).toContain('Modifier le rendez-vous');
    const title = host.querySelector<HTMLInputElement>('.calendar-modal input')!;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(title), 'value')!.set!.call(
      title,
      'Dentiste',
    );
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }));
      await Promise.resolve();
    });
    expect(
      requests.some(
        (request) =>
          request.method === 'PATCH' &&
          request.url === '/api/v1/calendar/appointment-1' &&
          request.body?.includes('Dentiste'),
      ),
    ).toBe(true);
    act(() => (host.querySelector('.calendar-event') as HTMLButtonElement).click());
    await act(async () => {
      (host.querySelector('.calendar-delete') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(
      requests.some(
        (request) =>
          request.method === 'DELETE' && request.url === '/api/v1/calendar/appointment-1?scope=ONE',
      ),
    ).toBe(true);
  });
});
