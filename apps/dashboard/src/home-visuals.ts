import type { PlanRoom } from '@michel/contracts';
import {
  Bath,
  BedDouble,
  Boxes,
  CookingPot,
  DoorOpen,
  Footprints,
  Home,
  Sofa,
  Sun,
  Toilet,
  Trees,
  Utensils,
  Warehouse,
} from 'lucide-react';

const roomIcons: Record<string, typeof Home> = {
  LIVING_ROOM: Sofa,
  KITCHEN: CookingPot,
  BEDROOM: BedDouble,
  BATHROOM: Bath,
  TOILET: Toilet,
  ENTRANCE: DoorOpen,
  HALLWAY: Footprints,
  DINING_ROOM: Utensils,
  GARAGE: Warehouse,
  GARDEN: Trees,
  TERRACE: Sun,
};

export const roomIconKey = (room: Pick<PlanRoom, 'kind' | 'name'>) => {
  if (room.kind !== 'OTHER' && roomIcons[room.kind]) return room.kind;

  const name = room.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (/salon|sejour/.test(name)) return 'LIVING_ROOM';
  if (/cuisine/.test(name)) return 'KITCHEN';
  if (/chambre/.test(name)) return 'BEDROOM';
  if (/salle de bain|sdb|douche/.test(name)) return 'BATHROOM';
  if (/toilette|\bwc\b/.test(name)) return 'TOILET';
  if (/entree|vestibule/.test(name)) return 'ENTRANCE';
  if (/couloir|degagement|palier/.test(name)) return 'HALLWAY';
  if (/salle a manger/.test(name)) return 'DINING_ROOM';
  if (/garage/.test(name)) return 'GARAGE';
  if (/jardin/.test(name)) return 'GARDEN';
  if (/terrasse|balcon/.test(name)) return 'TERRACE';
  if (/cagibi|cellier|rangement|placard|reserve/.test(name)) return 'STORAGE';
  return 'OTHER';
};

export const roomIcon = (room: Pick<PlanRoom, 'kind' | 'name'>) =>
  roomIconKey(room) === 'STORAGE' ? Boxes : (roomIcons[roomIconKey(room)] ?? Home);

export const roomKindLabel = (kind: string, locale: 'fr' | 'en') => {
  const labels: Record<string, [string, string]> = {
    LIVING_ROOM: ['Salon', 'Living room'],
    KITCHEN: ['Cuisine', 'Kitchen'],
    BEDROOM: ['Chambre', 'Bedroom'],
    BATHROOM: ['Salle de bain', 'Bathroom'],
    TOILET: ['Toilettes', 'Toilet'],
    ENTRANCE: ['Entrée', 'Entrance'],
    HALLWAY: ['Couloir', 'Hallway'],
    DINING_ROOM: ['Salle à manger', 'Dining room'],
    GARAGE: ['Garage', 'Garage'],
    GARDEN: ['Jardin', 'Garden'],
    TERRACE: ['Terrasse', 'Terrace'],
    STORAGE: ['Rangement', 'Storage'],
    OTHER: ['Autre', 'Other'],
  };
  return labels[kind]?.[locale === 'fr' ? 0 : 1] ?? kind;
};
