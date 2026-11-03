import type { ActivityItem } from '../api';
import { tr } from '../locale';

export const relativeTime = (value?: string | null, now = Date.now()) => {
  if (!value) return tr('Jamais', 'Never');
  const minutes = Math.max(0, Math.round((now - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return tr('À l’instant', 'Just now');
  if (minutes < 60) return tr(`Il y a ${minutes} min`, `${minutes} min ago`);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return tr(`Il y a ${hours} h`, `${hours} hr ago`);
  return tr(`Il y a ${Math.round(hours / 24)} j`, `${Math.round(hours / 24)} d ago`);
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
  if (typeof payload.open === 'boolean')
    return payload.open ? tr('Ouvert', 'Open') : tr('Fermé', 'Closed');
  if (typeof payload.active === 'boolean')
    return payload.active ? tr('Détecté', 'Detected') : tr('Inactif', 'Inactive');
  return null;
};

export const roomOf = (item: ActivityItem) =>
  item.room ?? item.sensor?.room?.name ?? tr('Maison', 'Home');
