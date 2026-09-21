import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JournalPage } from './JournalPage';

describe('JournalPage', () => {
  it('explains how to start an empty household journal', () => {
    const html = renderToStaticMarkup(<JournalPage items={[]} onBack={() => undefined} />);

    expect(html).toContain('Journal du foyer');
    expect(html).toContain('Le journal commence ici');
    expect(html).toContain('Écrire une première note');
  });

  it('groups entries by date and labels their source', () => {
    const html = renderToStaticMarkup(
      <JournalPage
        items={[
          {
            id: 'summary',
            kind: 'DAILY_SUMMARY',
            title: 'Tout semble normal',
            body: 'La matinée suit le rythme habituel.',
            occurredAt: '2026-09-21T08:30:00.000Z',
          },
          {
            id: 'note',
            kind: 'NOTE',
            title: 'Passage de Claire',
            body: 'Le pilulier est prêt.',
            occurredAt: '2026-09-20T16:00:00.000Z',
          },
        ]}
      />,
    );

    expect(html).toContain('Bilan du jour');
    expect(html).toContain('Note familiale');
    expect(html).toContain('Tout semble normal');
    expect(html).toContain('Passage de Claire');
    expect(html).toContain('2 événements');
  });
});
