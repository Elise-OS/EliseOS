import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataLoadingScreen } from './DataLoadingScreen';

describe('DataLoadingScreen', () => {
  it('shows the shared branded loading experience in French', () => {
    const html = renderToStaticMarkup(
      <DataLoadingScreen locale="fr" message="Chargement du logement…" fullPage />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('data-loading-screen--full');
    expect(html).toContain('/logo-transparent.png');
    expect(html).toContain('data-loading-wordmark');
    expect(html).toContain('Votre espace prend vie');
    expect(html).toContain('Chargement du logement…');
    expect(html).toContain('Vos données restent chez vous.');
  });

  it('is fully translated in English', () => {
    const html = renderToStaticMarkup(<DataLoadingScreen locale="en" />);

    expect(html).toContain('Your space is coming to life');
    expect(html).toContain('Loading your data…');
    expect(html).toContain('Your data stays in your home.');
  });
});
