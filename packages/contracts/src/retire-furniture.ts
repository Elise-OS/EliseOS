import type { HomePlan } from './index.js';

export const LEGACY_FURNITURE_LABELS: Record<string, string> = {
  BED: 'Lit double',
  SINGLE_BED: 'Lit simple',
  SOFA: 'Canapé',
  ARMCHAIR: 'Fauteuil',
  COFFEE_TABLE: 'Table basse',
  TABLE: 'Table',
  CHAIR: 'Chaise',
  TV_STAND: 'Meuble TV',
  SINK: 'Évier',
  WASHING_MACHINE: 'Lave-linge',
  DISHWASHER: 'Lave-vaisselle',
  SHOWER: 'Douche',
  BATHTUB: 'Baignoire',
  TOILET: 'Toilettes',
  FRIDGE: 'Réfrigérateur',
  CABINET: 'Placard',
  WARDROBE: 'Armoire',
  DRESSER: 'Commode',
  POWER_OUTLET: 'Prise',
  LAMP: 'Lampe',
  COFFEE_MACHINE: 'Cafetière',
  KETTLE: 'Bouilloire',
  MICROWAVE: 'Micro-ondes',
  MEDICAL_DEVICE: 'Appareil médical',
  OVEN: 'Four',
  DESK: 'Bureau',
};

/** Compatibility for old clients and backups. The persistent migration takes
 * the recovery copy before this transform is used by normal writes. */
export function retireFurniture(source: HomePlan): HomePlan {
  const plan = structuredClone(source);
  const items = new Map(
    plan.levels.flatMap(({ items }) => items.map((item) => [item.id, item] as const)),
  );
  for (const placement of plan.placements) {
    if (placement.targetType !== 'ITEM') continue;
    const item = items.get(placement.targetId ?? '');
    const note = item
      ? `Ancien emplacement : ${LEGACY_FURNITURE_LABELS[item.kind] ?? item.kind}`
      : 'Ancien emplacement : mobilier';
    // The original note remains intact, including if it already takes all 500 characters.
    if (!placement.placementNote?.includes(note))
      placement.placementNote = [placement.placementNote, note]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 500);
    placement.targetType = 'ROOM';
    placement.targetId = placement.roomId;
    placement.openingId = null;
  }
  for (const floor of plan.levels) floor.items = [];
  return plan;
}
