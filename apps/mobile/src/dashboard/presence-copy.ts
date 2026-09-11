import type { PresenceEstimate } from '@michel/contracts';

export function caregiverPresenceCopy(presence: PresenceEstimate | null) {
  if (!presence)
    return {
      title: 'Aucune présence fiable',
      detail: 'En attente des capteurs de présence.',
      why: 'Aucune preuve de présence exploitable n’a encore été reçue.',
    };
  const title =
    presence.trackingState === 'CONFIRMED'
      ? 'Présence confirmée'
      : presence.trackingState === 'IN_TRANSIT'
        ? 'Déplacement probable'
        : presence.trackingState === 'AMBIGUOUS'
          ? 'Présence non attribuée'
          : presence.trackingState === 'STALE'
            ? 'Dernière présence fiable'
            : 'Aucune présence fiable';
  const why =
    presence.trackingState === 'IN_TRANSIT'
      ? 'La dernière pièce fiable reste affichée pendant 20 à 30 secondes, le temps de confirmer la destination.'
      : presence.trackingState === 'AMBIGUOUS'
        ? 'Plusieurs capteurs indiquent des pièces différentes ou la présence possible d’un visiteur.'
        : 'Seuls les capteurs explicitement configurés pour la présence participent à cette estimation.';
  return { title, detail: presence.explanation, why };
}
