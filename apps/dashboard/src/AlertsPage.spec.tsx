import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AlertsPage } from './AlertsPage';

describe('page Alertes', () => {
  it('shows the requested layout without claiming no emergency before the server responds', () => {
    const html = renderToStaticMarkup(
      <AlertsPage
        locale="fr"
        canManage
        residentName="Élise"
        timezone="Europe/Paris"
        onSettings={() => undefined}
        onCall={() => Promise.resolve()}
        onChanged={() => Promise.resolve()}
      />,
    );

    expect(html).toContain('ALERTES DU DOMICILE');
    expect(html).toContain('Situation du jour');
    expect(html).toContain('Règles des alertes');
    expect(html).toContain('État des urgences indisponible');
    expect(html).not.toContain('Aucune urgence en cours');
  });
});
