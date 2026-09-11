import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { copy } from './i18n';
import {
  activityDescription,
  AlertRulesPanel,
  Login,
  MedicationPanel,
  PeoplePanel,
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
  });

  it('hides medications and journal from the sidebar in both languages', () => {
    for (const labels of [copy.fr.nav, copy.en.nav]) {
      const html = renderToStaticMarkup(
        <SidebarNavigation labels={labels} active={0} openAlerts={0} onSelect={() => undefined} />,
      );

      expect(html).not.toContain(labels[5]);
      expect(html).not.toContain(labels[6]);
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

describe('People access design', () => {
  it('shows management actions only to administrators', () => {
    const viewer = renderToStaticMarkup(<PeoplePanel locale="fr" currentRole="VIEWER" />);
    const owner = renderToStaticMarkup(<PeoplePanel locale="fr" currentRole="OWNER" />);
    expect(viewer).toContain('Les proches');
    expect(viewer).not.toContain('Ajouter un proche');
    expect(owner).toContain('Ajouter un proche');
    expect(owner).toContain('contacts prioritaires');
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

describe('Élise sensors panel design', () => {
  it('renders modern reassuring sensor management with room groupings and quick filters', async () => {
    const { SensorsPanel } = await import('./SensorsPanel');
    const html = renderToStaticMarkup(
      <SensorsPanel
        locale="fr"
        rooms={[
          { id: 'living-room', name: 'Salon', kind: 'LIVING_ROOM' },
          { id: 'kitchen', name: 'Cuisine', kind: 'KITCHEN' },
        ]}
      />,
    );

    expect(html).toContain('Capteurs &amp; Équipements');
    expect(html).toContain('Protection &amp; Sérénité du domicile');
    expect(html).toContain('Tous les capteurs');
    expect(html).toContain('Opérationnels');
    expect(html).toContain('À installer / poser');
    expect(html).toContain('Piles faibles');
    expect(html).toContain('Par pièces');
    expect(html).toContain('Ajouter un capteur');
    expect(html).toContain('Vérification de la clé');
    expect(html).toContain('Jumeler un équipement');
    expect(html).toContain('Le domicile, pièce par pièce');
    expect(html).not.toContain('Aucun capteur dans cette pièce');
    expect(html).not.toContain('class="sensors-room-section"');
  });
});
