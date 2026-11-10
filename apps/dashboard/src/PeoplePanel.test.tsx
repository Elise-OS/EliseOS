// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PeoplePanel } from './App';

describe('PeoplePanel design', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
  });

  afterEach(() => {
    container.remove();
    vi.unstubAllGlobals();
  });

  it('shows a caregiver pictogram and keeps the hero action together', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              id: 'caregiver-1',
              firstName: 'Camille',
              lastName: 'Martin',
              relation: 'Fille',
              role: 'CAREGIVER',
              phone: '0102030405',
              email: null,
              username: 'camille',
              isEmergency: false,
              priority: 0,
              hasAccount: true,
              accessDisabled: false,
              archived: false,
              isCurrentUser: false,
            },
          ]),
      }),
    );
    const root = createRoot(container);

    await act(async () => {
      root.render(<PeoplePanel locale="fr" currentRole="OWNER" />);
      await Promise.resolve();
    });

    const card = container.querySelector('.people-card.role-card-CAREGIVER');
    expect(card).toBeTruthy();
    expect(card?.querySelector('.people-avatar .lucide-heart-handshake')).toBeTruthy();
    expect(card?.querySelector('.people-card-accent')).toBeNull();
    expect(card?.querySelector('.people-edit .lucide-chevron-right')).toBeTruthy();
    expect(container.querySelector('.people-hero .people-add-button')?.textContent).toContain(
      'Ajouter un proche',
    );

    act(() => root.unmount());
  });
});
