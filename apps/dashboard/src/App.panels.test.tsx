// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PeoplePanel } from './App';

const roots: Root[] = [];

function mount(node: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(node));
  return container;
}

function jsonResponse(value: unknown): Response {
  return { ok: true, json: () => Promise.resolve(value) } as Response;
}

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('People access design', () => {
  it('shows management actions only to administrators', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse([]))),
    );

    const viewer = mount(<PeoplePanel locale="fr" currentRole="VIEWER" />);
    const owner = mount(<PeoplePanel locale="fr" currentRole="OWNER" />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(viewer.textContent).toContain('Les proches');
    expect(viewer.textContent).not.toContain('Ajouter un proche');
    expect(owner.textContent).toContain('Ajouter un proche');
    expect(owner.textContent).toContain('contacts prioritaires');
  });
});
