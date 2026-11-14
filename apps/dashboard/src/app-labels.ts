import { t as i18nT } from './i18n';
import type { ActivityItem } from './app-types';

export function time(value?: string): string {
  if (!value) return '—';
  const date = new Date(Number.isNaN(Number(value)) ? value : Number(value));
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function formatMinute(value: number | null): string {
  if (value === null) return '—';
  return `${String(Math.floor(value / 60)).padStart(2, '0')} h ${String(value % 60).padStart(2, '0')}`;
}

export function residentAge(value: string | null): string | null {
  if (!value) return null;
  const birthDate = new Date(value);
  if (Number.isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  if (
    today.getMonth() < birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }
  return i18nT('app.yearsOld', { age });
}

export function residentMobilityLabel(value: string): string {
  const labels: Record<string, () => string> = {
    INDEPENDENT: () => i18nT('app.residentMobilityLabel.labels.INDEPENDENT'),
    CANE: () => i18nT('app.residentMobilityLabel.labels.CANE'),
    WALKER: () => i18nT('app.residentMobilityLabel.labels.WALKER'),
    WHEELCHAIR: () => i18nT('app.residentMobilityLabel.labels.WHEELCHAIR'),
    UNKNOWN: () => i18nT('app.residentMobilityLabel.labels.UNKNOWN'),
  };
  return labels[value]?.() ?? value;
}

export function supportNeedLabel(value: string): string {
  const labels: Record<string, () => string> = {
    MEMORY: () => i18nT('app.supportNeedLabel.labels.MEMORY'),
    PARKINSON: () => i18nT('app.supportNeedLabel.labels.PARKINSON'),
    FALL_RISK: () => i18nT('app.supportNeedLabel.labels.FALL_RISK'),
    VISION: () => i18nT('app.supportNeedLabel.labels.VISION'),
    HEARING: () => i18nT('app.supportNeedLabel.labels.HEARING'),
    OTHER: () => i18nT('app.supportNeedLabel.labels.OTHER'),
  };
  return labels[value]?.() ?? value;
}

export function habitLabel(value: string): string {
  const labels: Record<string, () => string> = {
    WAKE_UP: () => i18nT('app.habitLabel.labels.WAKE_UP'),
    BREAKFAST: () => i18nT('app.habitLabel.labels.BREAKFAST'),
    LUNCH: () => i18nT('app.habitLabel.labels.LUNCH'),
    DINNER: () => i18nT('app.habitLabel.labels.DINNER'),
    BEDTIME: () => i18nT('app.habitLabel.labels.BEDTIME'),
    NIGHT: () => i18nT('app.habitLabel.labels.NIGHT'),
    // Habits named during the first setup keep their French names.
    Lever: () => i18nT('app.habitLabel.labels.Lever'),
    Déjeuner: () => i18nT('app.habitLabel.labels.Déjeuner'),
    Dîner: () => i18nT('app.habitLabel.labels.Dîner'),
    Coucher: () => i18nT('app.habitLabel.labels.Coucher'),
  };
  return (
    labels[value]?.() ??
    value
      .toLowerCase()
      .replaceAll('_', ' ')
      .replace(/^./, (letter) => letter.toUpperCase())
  );
}

export function capabilityLabel(capability: string): string {
  const labels: Record<string, () => string> = {
    motion: () => i18nT('app.capabilityLabel.labels.motion'),
    occupancy: () => i18nT('app.capabilityLabel.labels.occupancy'),
    person_presence: () => i18nT('app.capabilityLabel.labels.person_presence'),
    contact: () => i18nT('app.capabilityLabel.labels.contact'),
    dry_contact: () => i18nT('app.capabilityLabel.labels.dry_contact'),
    button: () => i18nT('app.capabilityLabel.labels.button'),
    temperature: () => i18nT('app.capabilityLabel.labels.temperature'),
    humidity: () => i18nT('app.capabilityLabel.labels.humidity'),
    power: () => i18nT('app.capabilityLabel.labels.power'),
    energy: () => i18nT('app.capabilityLabel.labels.energy'),
    battery: () => i18nT('app.capabilityLabel.labels.battery'),
  };
  return labels[capability]?.() ?? capability;
}

export function activityDescription(item: ActivityItem): string {
  const payload =
    item.payload && typeof item.payload === 'object'
      ? (item.payload as Record<string, unknown>)
      : {};
  const context =
    payload.context && typeof payload.context === 'object'
      ? (payload.context as Record<string, unknown>)
      : {};
  const contactRole = typeof context.role === 'string' ? context.role : null;
  const bedOccupiedWhen =
    context.bedOccupiedWhen === 'OPEN' || item.capability === 'occupancy' ? 'OPEN' : 'CLOSED';
  const rawValue = ['contact', 'dry_contact', 'occupancy'].includes(item.capability)
    ? (payload.open ?? payload.active ?? payload.value ?? payload.state)
    : (payload.value ?? payload.state);
  const unit = typeof payload.unit === 'string' ? payload.unit : '';
  const value =
    typeof rawValue === 'number' || typeof rawValue === 'string'
      ? `${rawValue}${unit ? ` ${unit}` : ''}`
      : null;
  const contactOpen =
    rawValue === true || rawValue === 'open' || rawValue === 'on' || rawValue === 1;
  const bed = () =>
    contactOpen === (bedOccupiedWhen === 'OPEN')
      ? i18nT('app.activityText.bedOccupied')
      : i18nT('app.activityText.bedUnoccupied');
  const labels: Record<string, () => string> = {
    motion: () => i18nT('app.activityText.movementDetected'),
    occupancy: () =>
      contactRole === 'BED'
        ? contactOpen
          ? i18nT('app.activityText.bedOccupied')
          : i18nT('app.activityText.bedUnoccupied')
        : i18nT('app.activityText.presenceDetected'),
    person_presence: () => i18nT('app.activityText.personDetected'),
    contact: () =>
      contactRole === 'BED'
        ? bed()
        : contactRole === 'FRIDGE'
          ? contactOpen
            ? i18nT('app.activityText.fridgeOpen')
            : i18nT('app.activityText.fridgeClosed')
          : contactOpen
            ? i18nT('app.activityText.openingDetected')
            : i18nT('app.activityText.closingDetected'),
    dry_contact: () =>
      contactRole === 'BED'
        ? bed()
        : contactOpen
          ? i18nT('app.activityText.contactOpen')
          : i18nT('app.activityText.contactClosed'),
    temperature: () =>
      value
        ? i18nT('app.activityText.temperatureWithValue', { value })
        : i18nT('app.activityText.temperature'),
    humidity: () =>
      value
        ? i18nT('app.activityText.humidityWithValue', { value })
        : i18nT('app.activityText.humidity'),
    illuminance: () =>
      value
        ? i18nT('app.activityText.illuminanceWithValue', { value })
        : i18nT('app.activityText.illuminance'),
    battery: () =>
      value
        ? i18nT('app.activityText.batteryWithValue', { value })
        : i18nT('app.activityText.battery'),
    power: () =>
      value ? i18nT('app.activityText.powerWithValue', { value }) : i18nT('app.activityText.power'),
    energy: () =>
      value
        ? i18nT('app.activityText.energyWithValue', { value })
        : i18nT('app.activityText.energy'),
    button: () => i18nT('app.activityText.callButtonPressed'),
  };
  return labels[item.capability]?.() ?? capabilityLabel(item.capability);
}
