// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePlanEditor } from './HomePlanEditor';

describe('home setup preview', () => {
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

  it('runs the complete introduction without any network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const root = createRoot(container);

    act(() => {
      root.render(
        <HomePlanEditor
          locale="fr"
          home={undefined}
          sensors={[]}
          cameras={[]}
          onSaved={() => undefined}
          setupPreview
          onSetupPreviewClose={() => undefined}
        />,
      );
    });

    expect(container.textContent).toContain('Parlez-nous du logement');
    const next = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('Choisir les pièces'),
    );
    expect(next).toBeTruthy();

    await act(async () => {
      next?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Quelles pièces composent le logement');
    const addLivingRoom = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Ajouter Salon"]',
    );
    expect(addLivingRoom).toBeTruthy();
    await act(async () => {
      addLivingRoom?.click();
      await Promise.resolve();
    });
    const showTutorial = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('Voir comment dessiner'),
    );
    await act(async () => {
      showTutorial?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Regardez le geste');
    expect(container.querySelector('img[src="/craftlogement.png"]')).toBeTruthy();

    const beginDrawing = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('À moi de dessiner'),
    );
    await act(async () => {
      beginDrawing?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('À vous de jouer');
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => root.unmount());
  });
});
