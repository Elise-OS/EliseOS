import type { PresenceEstimate } from '@michel/contracts';
import { tr } from '../locale';

export function caregiverPresenceCopy(presence: PresenceEstimate | null) {
  if (!presence)
    return {
      title: tr('Aucune présence fiable', 'No reliable presence'),
      detail: tr('En attente des capteurs de présence.', 'Waiting for presence sensors.'),
      why: tr(
        'Aucune preuve de présence exploitable n’a encore été reçue.',
        'No usable evidence of presence has been received yet.',
      ),
    };
  const title =
    presence.trackingState === 'CONFIRMED'
      ? tr('Présence confirmée', 'Presence confirmed')
      : presence.trackingState === 'IN_TRANSIT'
        ? tr('Déplacement probable', 'Probably moving')
        : presence.trackingState === 'AMBIGUOUS'
          ? tr('Présence non attribuée', 'Presence not assigned')
          : presence.trackingState === 'STALE'
            ? tr('Dernière présence fiable', 'Last reliable presence')
            : tr('Aucune présence fiable', 'No reliable presence');
  const why =
    presence.trackingState === 'IN_TRANSIT'
      ? tr(
          'La dernière pièce fiable reste affichée pendant 20 à 30 secondes, le temps de confirmer la destination.',
          'The last reliable room stays shown for 20 to 30 seconds while the destination is confirmed.',
        )
      : presence.trackingState === 'AMBIGUOUS'
        ? tr(
            'Plusieurs capteurs indiquent des pièces différentes ou la présence possible d’un visiteur.',
            'Several sensors point to different rooms or a possible visitor.',
          )
        : tr(
            'Seuls les capteurs explicitement configurés pour la présence participent à cette estimation.',
            'Only sensors explicitly set up for presence take part in this estimate.',
          );
  return { title, detail: presence.explanation, why };
}
