import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RemoteAccessCard } from './RemoteAccessCard';

describe('RemoteAccessCard', () => {
  it('starts closed in settings while keeping its heading and status visible', () => {
    const html = renderToStaticMarkup(<RemoteAccessCard locale="fr" />);

    expect(html).toContain('<details class="remote-access-card"');
    expect(html).not.toContain('<details class="remote-access-card" open=""');
    expect(html).toContain('remote-access-chevron');
    expect(html).toContain('Accès à distance');
    expect(html).toContain('Vérification…');
  });

  it('keeps the onboarding version open', () => {
    const html = renderToStaticMarkup(<RemoteAccessCard locale="en" compact />);

    expect(html).toContain('<section class="remote-access-card is-compact"');
    expect(html).toContain('Remote access');
  });
});
