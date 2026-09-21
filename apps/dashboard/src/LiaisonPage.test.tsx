// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiaisonPage } from './LiaisonPage';
import type { LiaisonPage as Page } from '@michel/contracts';

const interact = (callback: () => unknown) =>
  act(async () => {
    callback();
    await Promise.resolve();
  });

describe('Family notebook web', () => {
  let root: Root;
  let host: HTMLDivElement;
  let page: Page;
  let requests: Array<{ url: string; method: string; body: unknown }>;
  let fail: boolean;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    page = {
      items: [],
      nextCursor: null,
      members: [{ id: 'paul', displayName: 'Paul' }],
      visits: [],
      canWrite: true,
      timezone: 'Europe/Paris',
      today: '2026-09-20',
    };
    fail = false;
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
          body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
        });
        return Promise.resolve({ ok: !fail, json: () => Promise.resolve(page) });
      }),
    );
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await interact(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
  const render = () => interact(() => root.render(<LiaisonPage />));
  const button = (text: string) =>
    Array.from(host.querySelectorAll('button')).find((node) => node.textContent === text)!;
  const click = (text: string) => interact(() => button(text).click());
  const input = async (selector: string, value: string) => {
    const element = host.querySelector(selector) as
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    await interact(() => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!.call(
        element,
        value,
      );
      element.dispatchEvent(
        new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }),
      );
    });
  };
  it('creates an assigned task with a calendar date', async () => {
    await render();
    await click('Note');
    await click('Repas');
    await input('textarea', 'Apporter du pain');
    await input('select', 'paul');
    await input('input[type=date]', '2026-10-01');
    await interact(() =>
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(requests.find((r) => r.method === 'POST')?.body).toEqual({
      kind: 'TASK',
      body: 'Apporter du pain',
      tags: ['MEAL'],
      assigneeId: 'paul',
      dueOn: '2026-10-01',
    });
    expect(host.textContent).toContain('Votre note a été partagée.');
    expect(host.querySelector('textarea')?.value).toBe('');
  });
  it('preserves the draft and reports an unsuccessful save', async () => {
    await render();
    await input('textarea', 'Je suis passé');
    fail = true;
    await interact(() =>
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(host.querySelector('textarea')?.value).toBe('Je suis passé');
    expect(host.querySelector('[role=alert]')?.textContent).toContain(
      'Modification non enregistrée',
    );
  });
  it('shows authors, overdue tasks and completion actions', async () => {
    page.items = [
      {
        id: 'task',
        kind: 'TASK',
        body: 'Pain',
        tags: ['MEAL'],
        createdAt: '2026-09-18T10:00:00Z',
        author: { id: 'paul', displayName: 'Paul' },
        assignee: null,
        dueOn: '2026-09-19',
        completedAt: null,
        completedBy: null,
      },
    ];
    await render();
    expect(host.textContent).toContain('Repas');
    expect(host.textContent).toContain('Paul');
    await click('C’est fait');
    expect(requests.find((r) => r.method === 'PATCH')).toMatchObject({
      url: '/api/v1/liaison/task/completion',
      body: { completed: true },
    });
  });
  it('makes the reader view read-only', async () => {
    page.canWrite = false;
    await render();
    expect(button('Ajouter une note')).toBeUndefined();
    expect(host.textContent).toContain('Vous pouvez consulter ce carnet');
  });
  it('uses server-side task filters and a cursor for older entries', async () => {
    page.nextCursor = 'older';
    await render();
    await click('À faire');
    expect(requests.at(-1)?.url).toBe('/api/v1/liaison?filter=OPEN');
    await click('Voir les notes précédentes');
    expect(requests.at(-1)?.url).toBe('/api/v1/liaison?filter=OPEN&cursor=older');
  });
  it('allows confirmation of past visits only', async () => {
    page.visits = [
      {
        id: 'past',
        visitorName: 'Sophie',
        startsAt: '2020-01-01T10:00:00Z',
        endsAt: null,
        notes: 'Courses',
        completedAt: null,
        completedBy: null,
      },
      {
        id: 'future',
        visitorName: 'Paul',
        startsAt: '2099-01-01T10:00:00Z',
        endsAt: null,
        notes: null,
        completedAt: null,
        completedBy: null,
      },
    ];
    await render();
    await click('Visites');
    expect(
      Array.from(host.querySelectorAll('button')).filter(
        (b) => b.textContent === 'La visite a eu lieu',
      ),
    ).toHaveLength(1);
    await click('La visite a eu lieu');
    expect(requests.find((r) => r.method === 'PATCH')?.url).toBe(
      '/api/v1/liaison/visits/past/completion',
    );
  });
});
