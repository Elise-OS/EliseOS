const LABELS: Record<string, string> = {
  camera: 'Caméra',
  motion: 'Mouvement',
  occupancy: 'Présence',
  person_presence: 'Présence humaine',
  contact: 'Ouverture',
  button: 'Bouton d’assistance',
  temperature: 'Température',
  humidity: 'Humidité',
  power: 'Puissance',
  energy: 'Énergie',
  battery: 'Batterie',
  water_leak: 'Fuite d’eau',
  smoke: 'Fumée',
  carbon_monoxide: 'Monoxyde de carbone',
  co2: 'CO₂',
  voc: 'Composés organiques volatils',
  pm25: 'Particules fines',
  air_quality: 'Qualité de l’air',
  illuminance: 'Luminosité',
  vibration: 'Vibration',
  fall_detection: 'Chute non visuelle',
  signal_strength: 'Qualité radio',
};

export const capabilityLabel = (capability: string): string =>
  LABELS[capability] ?? 'Capteur à identifier';

const BINARY = new Set([
  'motion',
  'occupancy',
  'person_presence',
  'contact',
  'button',
  'water_leak',
  'smoke',
  'carbon_monoxide',
  'vibration',
  'fall_detection',
]);

export function placementGuide(capabilities: string[], roomKind = 'OTHER', usage?: 'BED') {
  const primary =
    capabilities.find((item) => !['battery', 'signal_strength'].includes(item)) ?? 'unknown';
  const room = roomKind === 'BATHROOM' ? 'la salle de bain' : 'la pièce';

  if (usage === 'BED' && capabilities.some((item) => ['contact', 'dry_contact'].includes(item))) {
    return {
      title: 'Installer le contact du lit',
      summary:
        'Le module NodOn lit un contact sec raccordé à un tapis de pression placé sous le matelas.',
      steps: [
        'Placez le tapis de pression compatible sous le matelas, à la zone d’appui habituelle.',
        'Raccordez son contact libre de potentiel au module NodOn, sans aucune alimentation sur les bornes de contact.',
        'Gardez le module accessible et exposé à la lumière, ou installez sa pile de secours en zone sombre.',
        'Vérifiez dans la carte Lit que les états Occupé et Libre correspondent à la réalité ; inversez le réglage si nécessaire.',
      ],
      avoid: [
        'Plier ou coincer le tapis',
        'Placer le module photovoltaïque sous le matelas sans pile de secours',
      ],
      testInstruction:
        'Appuyez sur le tapis de pression puis relâchez-le pour vérifier les deux changements d’état.',
      safetyNote:
        'Le repère obtenu est une estimation de l’occupation du lit, pas une mesure du sommeil.',
    };
  }

  if (['motion', 'occupancy', 'person_presence'].includes(primary)) {
    return {
      title: 'Couvrir les passages utiles',
      summary: `Placez le capteur dans ${room}, orienté vers la zone de passage sans filmer ni enregistrer.`,
      steps: [
        'Fixez-le à la hauteur recommandée par le fabricant.',
        'Orientez-le vers le passage principal, pas directement vers une porte ou une fenêtre.',
        'Laissez la zone dégagée puis marchez devant le capteur pour le tester.',
      ],
      avoid: [
        'Radiateur, soleil direct et rideau mobile',
        'Zone masquée par un meuble',
        'Vue directe vers un espace intime',
      ],
      testInstruction: 'Passez normalement devant le capteur.',
      safetyNote: null,
    };
  }
  if (primary === 'contact') {
    return {
      title: 'Aligner les deux parties',
      summary:
        'Fixez une partie sur l’ouvrant et l’autre sur le cadre, au plus près l’une de l’autre.',
      steps: [
        'Nettoyez et séchez le support.',
        'Alignez les repères aimantés porte fermée.',
        'Ouvrez puis refermez une fois.',
      ],
      avoid: ['Charnière ou surface qui vibre', 'Écart supérieur à celui indiqué par le fabricant'],
      testInstruction: 'Ouvrez puis refermez la porte ou la fenêtre.',
      safetyNote: null,
    };
  }
  if (primary === 'water_leak') {
    return {
      title: 'Au point le plus bas',
      summary: 'Posez la sonde au sol, là où l’eau apparaîtrait en premier.',
      steps: [
        'Placez-la sous l’évier, près du lave-linge ou du chauffe-eau.',
        'Gardez le boîtier et ses contacts accessibles.',
        'Utilisez le bouton de test du fabricant si disponible.',
      ],
      avoid: ['Surface régulièrement mouillée', 'Emplacement inaccessible'],
      testInstruction: 'Utilisez le test prévu par le fabricant, sans immerger le boîtier.',
      safetyNote:
        'Élise complète la vigilance du logement mais ne garantit pas la détection de toutes les fuites.',
    };
  }
  if (['smoke', 'carbon_monoxide'].includes(primary)) {
    return {
      title: 'Respecter la notice de sécurité',
      summary:
        'L’emplacement dépend du type de détecteur et des règles applicables dans le logement.',
      steps: [
        'Suivez en priorité la notice du fabricant.',
        'Utilisez la fixation prévue.',
        'Actionnez le bouton de test après la pose.',
      ],
      avoid: ['Recouvrir ou peindre le détecteur', 'Improviser une position contraire à la notice'],
      testInstruction: 'Appuyez sur le bouton de test du détecteur.',
      safetyNote: 'Élise n’est ni un dispositif de sécurité certifié ni un service d’urgence.',
    };
  }
  if (['temperature', 'humidity', 'co2', 'voc', 'pm25', 'air_quality'].includes(primary)) {
    return {
      title: 'Mesurer l’air ambiant',
      summary: 'Placez le capteur dans une zone représentative de la pièce et bien ventilée.',
      steps: [
        'Posez-le à hauteur de respiration.',
        'Éloignez-le des sources de chaleur et de vapeur.',
        'Attendez une première mesure stable.',
      ],
      avoid: [
        'Fenêtre ouverte, radiateur ou soleil direct',
        'Hotte, douche ou bouilloire à proximité immédiate',
      ],
      testInstruction: 'Attendez la réception d’une nouvelle mesure.',
      safetyNote: null,
    };
  }
  if (primary === 'button') {
    return {
      title: 'Rester facile à atteindre',
      summary:
        'Placez le bouton là où la personne peut l’utiliser sans effort et sans risque de chute.',
      steps: [
        'Choisissez un emplacement visible et accessible.',
        'Expliquez simplement son usage.',
        'Appuyez une fois pour vérifier la réception.',
      ],
      avoid: ['Derrière un meuble', 'Emplacement nécessitant de se pencher ou de monter'],
      testInstruction: 'Appuyez une fois sur le bouton.',
      safetyNote:
        'Ce bouton ne remplace pas une téléassistance disposant de sa propre liaison de secours.',
    };
  }
  return {
    title: 'Choisir une place représentative',
    summary: 'Suivez la notice du fabricant et gardez le capteur accessible pour son entretien.',
    steps: [
      'Affectez d’abord le capteur à une pièce.',
      'Fixez-le sans masquer sa zone de mesure.',
      'Déclenchez ou attendez une nouvelle mesure.',
    ],
    avoid: [
      'Source de chaleur ou d’humidité non représentative',
      'Zone inaccessible pour changer la pile',
    ],
    testInstruction: BINARY.has(primary)
      ? 'Déclenchez le capteur une fois.'
      : 'Attendez une nouvelle mesure.',
    safetyNote: null,
  };
}
