import type { PresenceEstimate } from '@elise/contracts';
import { t } from '../i18n';

export function caregiverPresenceCopy(presence: PresenceEstimate | null) {
  if (!presence)
    return {
      title: t('presenceCopy.noReliablePresence'),
      detail: t('presenceCopy.waitingForPresenceSensors'),
      why: t('presenceCopy.noUsableEvidenceOfPresence'),
    };
  const title =
    presence.trackingState === 'CONFIRMED'
      ? t('presenceCopy.presenceConfirmed')
      : presence.trackingState === 'IN_TRANSIT'
        ? t('presenceCopy.probablyMoving')
        : presence.trackingState === 'AMBIGUOUS'
          ? t('presenceCopy.presenceNotAssigned')
          : presence.trackingState === 'STALE'
            ? t('presenceCopy.lastReliablePresence')
            : t('presenceCopy.noReliablePresence');
  const why =
    presence.trackingState === 'IN_TRANSIT'
      ? t('presenceCopy.theLastReliableRoomStays')
      : presence.trackingState === 'AMBIGUOUS'
        ? t('presenceCopy.severalSensorsPointToDifferent')
        : t('presenceCopy.onlySensorsExplicitlySetUp');
  return { title, detail: presence.explanation, why };
}
