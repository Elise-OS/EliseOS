import { describe, expect, it } from 'vitest';
import { placementGuide } from './sensor-guidance';

describe('sensor placement guidance', () => {
  it('gives concrete movement placement and a real-world test', () => {
    const guide = placementGuide(['motion', 'battery'], 'LIVING_ROOM');
    expect(guide.title).toContain('passages');
    expect(guide.testInstruction).toContain('Passez');
    expect(guide.avoid.join(' ')).toContain('Radiateur');
  });

  it('keeps safety sensor wording prudent', () => {
    const guide = placementGuide(['smoke'], 'KITCHEN');
    expect(guide.summary).toContain('règles applicables');
    expect(guide.safetyNote).toContain('service d’urgence');
  });

  it('treats battery as secondary when choosing guidance', () => {
    const guide = placementGuide(['battery', 'water_leak'], 'BATHROOM');
    expect(guide.title).toContain('point le plus bas');
  });
});
