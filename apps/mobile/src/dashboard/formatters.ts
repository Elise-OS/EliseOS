import type { ActivityItem } from '../api';
import { t } from '../i18n';

export const relativeTime = (value?: string | null, now = Date.now()) => {
  if (!value) return t('formatters.never');
  const minutes = Math.max(0, Math.round((now - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return t('formatters.justNow');
  if (minutes < 60) return t('formatters.minAgo', { minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('formatters.hrAgo', { hours });
  return t('formatters.dAgo', { round: Math.round(hours / 24) });
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
    return payload.open ? t('formatters.open') : t('formatters.closed');
  if (typeof payload.active === 'boolean')
    return payload.active ? t('formatters.detected') : t('formatters.inactive');
  return null;
};

export const roomOf = (item: ActivityItem) =>
  item.room ?? item.sensor?.room?.name ?? t('formatters.home');
