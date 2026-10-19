import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { copy } from './i18n';
import {
  activityDescription,
  AlertRulesPanel,
  Login,
  MedicationPanel,
  SidebarBehaviorSetting,
  SidebarNavigation,
  SimulationPanel,
} from './App';
import { createBootstrapPayload, Setup } from './Setup';

describe('Élise copy', () => {
  it('ships complete reassurance copy in both languages', () => {
    expect(copy.fr.normal).toBeTruthy();
    expect(copy.en.normal).toBeTruthy();
    expect(copy.fr.nav).toHaveLength(copy.en.nav.length);
    expect(copy.fr.nav).toContain('Médicaments');
    expect(copy.fr.nav).toContain('Affichage TV');
  });

  it('hides the removed sensors page, medications and journal from the sidebar', () => {
    for (const labels of [copy.fr.nav, copy.en.nav]) {
      const html = renderToStaticMarkup(
        <SidebarNavigation labels={labels} active={0} openAlerts={0} onSelect={() => undefined} />,
      );

      expect(html).not.toContain(labels[4]);
      expect(html).not.toContain(labels[5]);
      expect(html).not.toContain(labels[6]);
      expect(html).toContain(labels[10]);
      expect(html).toContain(labels[11]);
      expect(html).toContain(labels[9]);
      expect(html.indexOf(labels[10])).toBeLessThan(html.indexOf(labels[3]));
    }
  });

  it('offers automatic sidebar hiding but keeps it off during environment creation', () => {
    const available = renderToStaticMarkup(
      <SidebarBehaviorSetting locale="fr" enabled disabled={false} onChange={() => undefined} />,
    );
    const duringSetup = renderToStaticMarkup(
      <SidebarBehaviorSetting locale="en" enabled disabled onChange={() => undefined} />,
    );

    expect(available).toContain('Masquer automatiquement la barre latérale');
    expect(available).toContain('aria-checked="true"');
    expect(duringSetup).toContain('sidebar stays open');
    expect(duringSetup).toContain('aria-checked="false"');
    expect(duringSetup).toContain('disabled=""');
  });

  it('translates sensor events with useful values instead of a generic message', () => {
    expect(
      activityDescription(
        {
          id: 'temperature-1',
          occurredAt: '2026-08-09T08:00:00.000Z',
          capability: 'temperature',
          room: 'Salon',
          payload: { value: 18.5, unit: '°C' },
        },
        'fr',
      ),
    ).toBe('Température · 18.5 °C');
    expect(
      activityDescription(
        {
          id: 'door-1',
          occurredAt: '2026-08-09T08:00:00.000Z',
          capability: 'contact',
          room: 'Entrée',
          payload: { value: false },
        },
        'fr',
      ),
    ).toBe('Fermeture détectée');
    expect(
      activityDescription(
        {
          id: 'door-2',
          occurredAt: '2026-08-09T08:05:00.000Z',
          capability: 'contact',
          room: 'Entrée',
          payload: { open: true },
        },
        'fr',
      ),
    ).toBe('Ouverture détectée');
    expect(
      activityDescription(
        {
          id: 'fridge-1',
          occurredAt: '2026-08-09T08:10:00.000Z',
          capability: 'contact',
          room: 'Cuisine',
          payload: { open: true, context: { role: 'FRIDGE' } },
        },
        'fr',
      ),
    ).toBe('Frigo ouvert');
    expect(
      activityDescription(
        {
          id: 'fridge-2',
          occurredAt: '2026-08-09T08:11:00.000Z',
          capability: 'contact',
          room: 'Cuisine',
          payload: { open: false, context: { role: 'FRIDGE' } },
        },
        'fr',
      ),
    ).toBe('Frigo fermé');
    expect(
      activityDescription(
        {
          id: 'bed-1',
          occurredAt: '2026-08-09T20:00:00.000Z',
          capability: 'dry_contact',
          room: 'Chambre',
          payload: { active: true, context: { role: 'BED', bedOccupiedWhen: 'OPEN' } },
        },
        'fr',
      ),
    ).toBe('Lit occupé');
    expect(
      activityDescription(
        {
          id: 'bed-2',
          occurredAt: '2026-08-10T06:00:00.000Z',
          capability: 'contact',
          room: 'Chambre',
          payload: { open: true, context: { role: 'BED', bedOccupiedWhen: 'CLOSED' } },
        },
        'fr',
      ),
    ).toBe('Lit libre');
    expect(
      activityDescription(
        {
          id: 'bed-pressure-1',
          occurredAt: '2026-08-10T06:05:00.000Z',
          capability: 'occupancy',
          room: 'Chambre',
          payload: { active: true, context: { role: 'BED', bedOccupiedWhen: 'OPEN' } },
        },
        'fr',
      ),
    ).toBe('Lit occupé');
    expect(
      activityDescription(
        {
          id: 'bed-pressure-2',
          occurredAt: '2026-08-10T06:30:00.000Z',
          capability: 'occupancy',
          room: 'Chambre',
          payload: { active: false, context: { role: 'BED', bedOccupiedWhen: 'OPEN' } },
        },
        'fr',
      ),
    ).toBe('Lit libre');
    expect(
      activityDescription(
        {
          id: 'light-1',
          occurredAt: '2026-08-09T08:00:00.000Z',
          capability: 'illuminance',
          room: 'Cuisine',
          payload: {},
        },
        'fr',
      ),
    ).toBe('Luminosité mesurée');
  });
});

describe('Élise first startup', () => {
  it('starts with the local setup welcome step', () => {
    const html = renderToStaticMarkup(
      <Setup locale="fr" onLocaleChange={() => undefined} onCompleted={() => undefined} />,
    );
    expect(html).toContain('Préparons Élise pour une personne qui compte');
    expect(html).toContain('Étape 1 sur 6');
    expect(html).toContain('Vos données restent stockées localement');
    expect(html).toContain('Français');
    expect(html).not.toContain('Téléphone');
  });

  it('renders the onboarding in English when English is selected', () => {
    const html = renderToStaticMarkup(
      <Setup locale="en" onLocaleChange={() => undefined} onCompleted={() => undefined} />,
    );
    expect(html).toContain('Set up Élise for someone who matters');
    expect(html).toContain('Start setup');
    expect(html).toContain('Step 1 of 6 · Welcome');
    expect(html).toContain('Draft saved on this device');
    expect(html).not.toContain('Préparons Élise pour une personne qui compte');
  });

  it('builds the owner identity without collecting a phone number', () => {
    expect(createBootstrapPayload(' Paul ', ' Martin ', ' paul@example.com ', 'secret')).toEqual({
      displayName: 'Paul Martin',
      email: 'paul@example.com',
      password: 'secret',
    });
  });

  it('offers the first-home setup from the login screen', () => {
    const html = renderToStaticMarkup(
      <Login locale="fr" onSuccess={() => undefined} onOpenSetup={() => undefined} />,
    );
    expect(html).toContain('Créer un environnement Élise');
    expect(html).toContain('compte propriétaire protégé');
  });
});

describe('Élise simulation panel', () => {
  it('explains scenarios with human copy and a single action', () => {
    const html = renderToStaticMarkup(
      <SimulationPanel
        scenarios={[
          {
            id: 'low_temperature',
            title: 'Température basse',
            description: 'Place le salon à 15,5 °C depuis quinze minutes.',
          },
        ]}
        running={null}
        notice=""
        onRun={() => undefined}
      />,
    );
    expect(html).toContain('Tester une situation');
    expect(html).toContain('Température basse');
    expect(html).toContain('Lancer');
    expect(html).not.toContain('low_temperature');
  });
});

describe('Élise alert rule design', () => {
  it('uses reassuring labels and explains sensor coverage', () => {
    const html = renderToStaticMarkup(
      <AlertRulesPanel
        rules={{
          inactivity: { enabled: true, minutes: 180 },
          doorOpen: { enabled: true, minutes: 5 },
          lowTemperature: { enabled: true, celsius: 17, minutes: 15 },
          highTemperature: { enabled: true, celsius: 30, minutes: 15 },
          nightActivity: {
            enabled: true,
            startMinute: 1320,
            endMinute: 360,
            minimumEvents: 3,
          },
          sensorOffline: { enabled: true, minutes: 120 },
          lowBattery: { enabled: true, percent: 15 },
          behavioral: { enabled: false },
        }}
        saving={false}
        notice=""
        onChange={() => undefined}
        onSave={() => undefined}
      />,
    );
    expect(html).toContain('Situations à signaler');
    expect(html).toContain('<details');
    expect(html).toContain('settings-disclosure-chevron');
    expect(html).not.toContain('<details open=""');
    expect(html).toContain('Évite de confondre une panne avec une absence d’activité');
    expect(html).toContain('Enregistrer les repères');
    expect(html).not.toContain('MQTT');
  });
});

describe('Élise medication design', () => {
  it('prioritizes the next dose and keeps unconfirmed wording prudent', () => {
    const html = renderToStaticMarkup(
      <MedicationPanel
        locale="fr"
        medications={[]}
        doses={[
          {
            id: 'dose-1',
            scheduledFor: new Date().toISOString(),
            status: 'MISSED',
            confirmedAt: null,
            note: null,
            schedule: {
              graceMinutes: 60,
              medication: {
                id: 'medication-1',
                name: 'Traitement du matin',
                dosage: '1 comprimé',
                instructions: 'Avec un verre d’eau',
                active: true,
                schedules: [],
              },
            },
          },
        ]}
        submitting={false}
        notice=""
        onCreate={() => Promise.resolve(true)}
        onConfirm={() => undefined}
        onSkip={() => undefined}
      />,
    );

    expect(html).toContain('À vérifier avec douceur');
    expect(html).toContain('Traitement du matin');
    expect(html).toContain('Non confirmée');
    expect(html).toContain('Un oubli est possible');
    expect(html).toContain('Confirmer la prise');
    expect(html).not.toContain('n’a pas été pris');
  });
});
