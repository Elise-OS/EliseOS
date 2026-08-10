import type { ActivityItem } from '../api';

export const relativeTime = (value?: string | null, now = Date.now()) => {
  if (!value) return 'Jamais';
  const minutes = Math.max(0, Math.round((now - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "À l'instant";
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Il y a ${hours} h`;
  return `Il y a ${Math.round(hours / 24)} j`;
};

export const friendlyValue = (payload: Record<string, unknown> | null) => {
  if (!payload) return null;
  if (typeof payload.value === 'number' || typeof payload.value === 'string') {
    const unit =
      typeof payload.unit === 'number' || typeof payload.unit === 'string'
        ? ` ${payload.unit}`
        : '';
    return `${payload.value}${unit}`;
  }
  if (typeof payload.open === 'boolean') return payload.open ? 'Ouvert' : 'Fermé';
  if (typeof payload.active === 'boolean') return payload.active ? 'Détecté' : 'Inactif';
  return null;
};

export const roomOf = (item: ActivityItem) => item.room ?? item.sensor?.room?.name ?? 'Maison';
