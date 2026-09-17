import type { RequestedRoom } from '@michel/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DrawingSetupPanel, HomeSetupOnboarding } from './HomeSetupOnboarding';

const room: RequestedRoom = {
  id: 'requested-living',
  name: 'Salon',
  kind: 'LIVING_ROOM',
  floor: 0,
};

const shared = {
  home: { name: 'Maison de Jeanne', type: 'Maison', address: '', timezone: 'Europe/Paris' },
  floorCount: 1,
  requestedRooms: [room],
  busy: false,
  error: '',
  preview: false,
  onSaveDetails: () => Promise.resolve(),
  onSaveRooms: () => Promise.resolve(),
  onBack: () => Promise.resolve(),
  onBeginDrawing: () => Promise.resolve(),
};

describe('home creation onboarding', () => {
  it('renders a full French home details page', () => {
    const html = renderToStaticMarkup(
      <HomeSetupOnboarding locale="fr" stage="DETAILS" {...shared} />,
    );
    expect(html).toContain('Création du logement');
    expect(html).toContain('Parlez-nous du logement');
    expect(html).toContain('Choisir les pièces');
    expect(html).not.toContain('plan-wizard');
  });

  it('renders the room checklist in English', () => {
    const html = renderToStaticMarkup(
      <HomeSetupOnboarding locale="en" stage="ROOMS" {...shared} />,
    );
    expect(html).toContain('Which rooms are in the home?');
    expect(html).toContain('Living room');
    expect(html).toContain('See how to draw');
    expect(html).toContain('src="/logo-transparent.png"');
    expect(html).toContain('lucide-sofa');
    expect(html).toContain('lucide-cooking-pot');
  });

  it('shows the reference image and the room/link demonstration', () => {
    const html = renderToStaticMarkup(
      <HomeSetupOnboarding locale="fr" stage="EXAMPLE" {...shared} />,
    );
    expect(html).toContain('/craftlogement.png');
    expect(html).toContain('Regardez le geste');
    expect(html).toContain('Glisser sur la grille');
    expect(html).toContain('Relier si nécessaire');
    expect(html).toContain('Rejouer');
  });

  it('blocks confirmation until a real room exists', () => {
    const empty = renderToStaticMarkup(
      <DrawingSetupPanel
        locale="fr"
        requestedRooms={[room]}
        drawnRoomIds={new Set()}
        selectedRoomId={room.id}
        roomCount={0}
        busy={false}
        error=""
        preview
        onSelect={() => undefined}
        onShowExample={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    const ready = renderToStaticMarkup(
      <DrawingSetupPanel
        locale="fr"
        requestedRooms={[room]}
        drawnRoomIds={new Set([room.id])}
        selectedRoomId={null}
        roomCount={1}
        busy={false}
        error=""
        preview
        onSelect={() => undefined}
        onShowExample={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(empty).toMatch(/class="drawing-confirm" disabled=""/);
    expect(empty).toContain('Choisissez une pièce');
    expect(ready).toContain('Confirmer mon plan');
    expect(ready).toMatch(/class="drawing-confirm">Confirmer mon plan/);
  });
});
