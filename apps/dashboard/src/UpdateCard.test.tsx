import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { UpdateCard } from './UpdateCard';

const status = {
  state: 'AVAILABLE' as const,
  currentVersion: 'v0.1.0',
  latestVersion: 'v0.1.1',
  updateAvailable: true,
  authConfigured: true,
  authUsername: 'elise-os-bot',
  checkedAt: '2026-09-21T20:00:00.000Z',
  releaseNotes: 'Corrections et améliorations.',
  progress: null,
  message: null,
  error: null,
};

describe('UpdateCard', () => {
  it('shows the available version and keeps the token out of the rendered status', () => {
    const html = renderToStaticMarkup(
      <UpdateCard
        locale="fr"
        status={status}
        busy={false}
        onCheck={vi.fn()}
        onSaveCredentials={vi.fn()}
        onDeleteCredentials={vi.fn()}
        onInstall={vi.fn()}
      />,
    );

    expect(html).toContain('Mise à jour d’Élise OS');
    expect(html).toContain('v0.1.1');
    expect(html).toContain('Installer v0.1.1');
    expect(html).not.toContain('ghp_secret_value');
  });
});
