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
      appointments: [],
      canWrite: true,
      timezone: 'Europe/Paris',
      today: '2026-09-20',
      residentName: 'Michel',
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
  it('creates a simple note from the composer', async () => {
    await render();
    await input('textarea', 'Apporter du pain');
    await interact(() =>
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(requests.find((r) => r.method === 'POST')?.body).toEqual({
      kind: 'NOTE',
      body: 'Apporter du pain',
    });
    expect(host.textContent).toContain('Votre note a été partagée.');
    expect(host.querySelector('textarea')?.value).toBe('');
  });
  it('adds a selected mood to the liaison timeline', async () => {
    await render();
    await click('Ajouter une humeur');
    expect(host.textContent).toContain('Comment se sent Michel ?');
    await click('Bien');
    expect(requests.find((r) => r.method === 'POST')?.body).toEqual({
      kind: 'NOTE',
      body: 'mood:GOOD',
      tags: ['MOOD'],
    });
    expect(host.textContent).toContain('Humeur ajoutée au carnet.');
  });
  it('renders older mood notes without emojis', async () => {
    page.items = [
      {
        id: 'mood',
        kind: 'NOTE',
        body: 'Humeur : 😢 Triste',
        tags: ['MOOD'],
        createdAt: new Date().toISOString(),
        author: { id: 'paul', displayName: 'Paul Breton' },
        assignee: null,
        dueOn: null,
        completedAt: null,
        completedBy: null,
      },
    ];
    await render();
    expect(host.textContent).toContain('Humeur de Michel : Triste');
    expect(host.textContent).not.toContain('😢');
  });
  it('keeps the same avatar color for the same author', async () => {
    const now = new Date().toISOString();
    page.items = [
      {
        id: 'first',
        kind: 'NOTE',
        body: 'Première note',
        tags: [],
        createdAt: now,
        author: { id: 'paul', displayName: 'Paul' },
        assignee: null,
        dueOn: null,
        completedAt: null,
        completedBy: null,
      },
      {
        id: 'other',
        kind: 'NOTE',
        body: 'Note de Claire',
        tags: [],
        createdAt: now,
        author: { id: 'claire', displayName: 'Claire' },
        assignee: null,
        dueOn: null,
        completedAt: null,
        completedBy: null,
      },
      {
        id: 'last',
        kind: 'NOTE',
        body: 'Deuxième note',
        tags: [],
        createdAt: now,
        author: { id: 'paul', displayName: 'Paul' },
        assignee: null,
        dueOn: null,
        completedAt: null,
        completedBy: null,
      },
    ];
    await render();
    const avatars = Array.from(host.querySelectorAll('.liaison-timeline .liaison-avatar'));
    expect(avatars).toHaveLength(3);
    expect(avatars[0]!.className).toBe(avatars[2]!.className);
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
        createdAt: new Date().toISOString(),
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
  it('lets a caregiver edit a message from its action menu', async () => {
    page.items = [
      {
        id: 'note-1',
        kind: 'NOTE',
        body: 'Ancien texte',
        tags: [],
        createdAt: new Date().toISOString(),
        author: { id: 'paul', displayName: 'Paul' },
        assignee: null,
        dueOn: null,
        completedAt: null,
        completedBy: null,
      },
    ];
    await render();
    await click('Modifier');
    expect(host.querySelector('[role=dialog]')?.textContent).toContain('Modifier le message');
    await input('#liaison-edit-body', 'Texte corrigé');
    await interact(() =>
      host
        .querySelector('#liaison-edit-body')!
        .closest('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(requests.find((request) => request.method === 'PATCH')).toMatchObject({
      url: '/api/v1/liaison/note-1',
      body: { body: 'Texte corrigé' },
    });
    expect(host.textContent).toContain('Message modifié.');
    expect(host.querySelector('[role=dialog]')).toBeNull();
  });
  it('changes an existing mood through the mood picker', async () => {
    page.items = [
      {
        id: 'mood-1',
        kind: 'NOTE',
        body: 'mood:GOOD',
        tags: ['MOOD'],
        createdAt: new Date().toISOString(),
        author: { id: 'paul', displayName: 'Paul' },
        assignee: null,
        dueOn: null,
        completedAt: null,
        completedBy: null,
      },
    ];
    await render();
    await click('Modifier');
    expect(host.querySelector('[role=dialog]')?.textContent).toContain('Modifier l’humeur');
    expect(host.querySelector('#liaison-edit-body')).toBeNull();
    await click('Triste');
    expect(requests.find((request) => request.method === 'PATCH')).toMatchObject({
      url: '/api/v1/liaison/mood-1',
      body: { body: 'mood:SAD', tags: ['MOOD'] },
    });
    expect(host.textContent).toContain('Humeur modifiée.');
    expect(host.querySelector('[role=dialog]')).toBeNull();
  });
  it('asks for confirmation before deleting a message', async () => {
    page.items = [
      {
        id: 'note-2',
        kind: 'NOTE',
        body: 'À supprimer',
        tags: [],
        createdAt: new Date().toISOString(),
        author: { id: 'paul', displayName: 'Paul' },
        assignee: null,
        dueOn: null,
        completedAt: null,
        completedBy: null,
      },
    ];
    await render();
    await click('Supprimer');
    expect(host.querySelector('[role=alertdialog]')).not.toBeNull();
    expect(requests.some((request) => request.method === 'DELETE')).toBe(false);
    await interact(() =>
      (
        host.querySelector('[role=alertdialog] .liaison-entry-dialog__delete') as HTMLButtonElement
      ).click(),
    );
    expect(requests.find((request) => request.method === 'DELETE')).toMatchObject({
      url: '/api/v1/liaison/note-2',
      body: null,
    });
    expect(host.textContent).toContain('Message supprimé.');
    expect(host.querySelector('[role=alertdialog]')).toBeNull();
  });
  it('makes the reader view read-only', async () => {
    page.canWrite = false;
    await render();
    expect(button('Ajouter une note')).toBeUndefined();
    expect(button('Modifier')).toBeUndefined();
    expect(button('Supprimer')).toBeUndefined();
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
  it('shows calendar appointments scheduled within the next seven days in highlights', async () => {
    page.appointments = [
      {
        id: 'appointment-j7',
        title: 'Consultation médicale',
        startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        endsAt: null,
        location: 'Cabinet médical',
        notes: null,
      },
    ];
    await render();
    expect(host.textContent).toContain('Rendez-vous');
    expect(host.textContent).toContain('Consultation médicale');
    expect(host.textContent).toContain('Cabinet médical');
  });
});
