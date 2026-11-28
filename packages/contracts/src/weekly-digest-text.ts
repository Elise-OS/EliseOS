import type {
  WeeklyDigest,
  WeeklyDigestLanguage,
  WeeklyDigestMeal,
  WeeklyDigestStatement,
  WeeklyDigestStatementKey,
} from './weekly-digest.js';

/**
 * Words of the weekly digest, in the five languages of Élise OS. The web space, the mobile app
 * and the PDF made on the box all read them here, so a sentence is the same everywhere.
 * Plain words for families: no jargon, an estimate is always called an estimate.
 */
export interface Plural {
  one: string;
  other: string;
}

export interface WeeklyDigestTexts {
  title: string;
  eyebrow: string;
  period: string;
  generatedOn: string;
  disclaimer: string;
  advice: string;
  usual: string;
  thisWeek: string;
  noData: string;
  readySoon: string;
  themes: Record<
    'changes' | 'nights' | 'meals' | 'outings' | 'visits' | 'alerts' | 'sensors',
    string
  >;
  trend: {
    later: string;
    earlier: string;
    longer: string;
    shorter: string;
    more: string;
    less: string;
    similar: string;
    noHistory: string;
    watch: string;
  };
  nights: {
    bedtime: string;
    wake: string;
    inBed: string;
    inBedEstimated: string;
    risings: string;
    perNight: string;
    sourceBed: string;
    sourceMotion: string;
    restless: Plural;
    short: Plural;
    calm: string;
    notEquipped: string;
    noData: string;
    partial: Plural;
    legendBar: string;
    legendUsual: string;
  };
  meals: {
    names: Record<WeeklyDigestMeal, string>;
    rows: Record<WeeklyDigestMeal, string>;
    seen: string;
    notSeen: string;
    unknown: string;
    seenCount: Plural;
    missed: Plural;
    noneMissed: string;
    fridge: string;
    seenLabel: string;
    missedLabel: string;
    fridgeLabel: string;
    perDay: string;
    method: string;
    notEquipped: string;
    noData: string;
  };
  outings: {
    label: string;
    count: Plural;
    timeLabel: string;
    daysWithoutLabel: string;
    duration: string;
    daysWithout: Plural;
    everyDay: string;
    legend: string;
    method: string;
    notEquipped: string;
    noData: string;
  };
  visits: {
    planned: Plural;
    confirmed: Plural;
    nonePlanned: string;
    plannedLabel: string;
    callsLabel: string;
    presenceLabel: string;
    calls: Plural;
    callsDuration: string;
    callsUnknown: string;
    presence: Plural;
    presenceHint: string;
    appointments: string;
    method: string;
    legendVisit: string;
    legendCall: string;
    legendPresence: string;
  };
  alerts: {
    none: string;
    count: Plural;
    severity: Record<'URGENT' | 'ATTENTION' | 'INFO', string>;
    more: Plural;
  };
  sensors: {
    allGood: string;
    daysWithout: Plural;
    offline: string;
    lowBattery: string;
    noSignal: string;
    since: string;
  };
  statements: Record<WeeklyDigestStatementKey, string | Plural>;
  pdf: {
    subtitle: string;
    audience: string;
    page: string;
    comparison: Plural;
    noComparison: string;
  };
}

const fr: WeeklyDigestTexts = {
  title: 'Bilan de la semaine',
  eyebrow: 'Carnet de liaison',
  period: 'Du {{from}} au {{to}}',
  generatedOn: 'Généré le {{date}} à {{time}}',
  disclaimer: 'Estimations issues de capteurs, pas un dispositif médical.',
  advice: 'En cas d’inquiétude, parlez-en au médecin ou à l’infirmière.',
  usual: 'D’habitude : {{value}}',
  thisWeek: 'Cette semaine',
  noData: 'Pas de données',
  readySoon: 'Le bilan de cette semaine sera prêt dimanche soir.',
  themes: {
    changes: 'Ce qui a changé',
    nights: 'Les nuits',
    meals: 'Les repas',
    outings: 'Les sorties',
    visits: 'Les visites',
    alerts: 'Les alertes',
    sensors: 'Capteurs et données',
  },
  trend: {
    later: '{{duration}} plus tard',
    earlier: '{{duration}} plus tôt',
    longer: '{{duration}} de plus',
    shorter: '{{duration}} de moins',
    more: 'Plus que d’habitude',
    less: 'Moins que d’habitude',
    similar: 'Comme d’habitude',
    noHistory: 'Habitude pas encore connue',
    watch: 'À regarder',
  },
  nights: {
    bedtime: 'Coucher',
    wake: 'Lever',
    inBed: 'Temps au lit',
    inBedEstimated: 'Durée de la nuit',
    risings: 'Levers la nuit',
    perNight: '{{count}} par nuit',
    sourceBed: 'Mesuré par le capteur du lit.',
    sourceMotion: 'Estimé à partir des mouvements dans le logement.',
    restless: { one: '{{count}} nuit plus agitée', other: '{{count}} nuits plus agitées' },
    short: {
      one: '{{count}} nuit plus courte que d’habitude',
      other: '{{count}} nuits plus courtes que d’habitude',
    },
    calm: 'Pas de nuit plus agitée que d’habitude.',
    notEquipped: 'Aucun capteur ne permet de suivre les nuits.',
    noData: 'Pas de données sur les nuits cette semaine.',
    partial: { one: '{{count}} nuit sans données', other: '{{count}} nuits sans données' },
    legendBar: 'Du coucher au lever',
    legendUsual: 'Lever habituel',
  },
  meals: {
    names: { BREAKFAST: 'Petit-déjeuner', LUNCH: 'Déjeuner', DINNER: 'Dîner' },
    rows: { BREAKFAST: 'Matin', LUNCH: 'Midi', DINNER: 'Soir' },
    seen: 'Activité en cuisine',
    notSeen: 'Pas d’activité vue',
    unknown: 'Pas de données',
    seenCount: {
      one: '{{count}} repas avec de l’activité en cuisine',
      other: '{{count}} repas avec de l’activité en cuisine',
    },
    missed: { one: '{{count}} repas semble manqué', other: '{{count}} repas semblent manqués' },
    noneMissed: 'Aucun repas ne semble manqué.',
    fridge: 'Réfrigérateur ouvert {{count}} fois par jour en moyenne',
    seenLabel: 'Repas avec activité',
    missedLabel: 'Semblent manqués',
    fridgeLabel: 'Réfrigérateur',
    perDay: '{{count}} / jour',
    method: 'Activité en cuisine et au réfrigérateur aux heures des repas.',
    notEquipped: 'Aucun capteur dans la cuisine ni sur le réfrigérateur.',
    noData: 'Pas de données sur les repas cette semaine.',
  },
  outings: {
    label: 'Sorties probables',
    count: { one: '{{count}} sortie', other: '{{count}} sorties' },
    timeLabel: 'Temps dehors',
    daysWithoutLabel: 'Jours sans sortie',
    duration: '{{duration}} dehors au total',
    daysWithout: { one: '{{count}} jour sans sortie', other: '{{count}} jours sans sortie' },
    everyDay: 'Au moins une sortie chaque jour.',
    legend: 'Hauteur : temps dehors, chiffre : nombre de sorties',
    method: 'Estimées avec la porte d’entrée et l’absence de mouvement à l’intérieur.',
    notEquipped: 'La porte d’entrée n’a pas de capteur : les sorties ne sont pas suivies.',
    noData: 'Pas de données sur les sorties cette semaine.',
  },
  visits: {
    planned: {
      one: '{{count}} visite au calendrier',
      other: '{{count}} visites au calendrier',
    },
    confirmed: {
      one: 'dont {{count}} confirmée dans le carnet',
      other: 'dont {{count}} confirmées dans le carnet',
    },
    nonePlanned: 'Aucune visite prévue au calendrier.',
    plannedLabel: 'Visites au calendrier',
    callsLabel: 'Appels vidéo',
    presenceLabel: 'Deux pièces à la fois',
    calls: {
      one: '{{count}} appel vidéo sur la télé',
      other: '{{count}} appels vidéo sur la télé',
    },
    callsDuration: '{{duration}} au total',
    callsUnknown: 'Les appels vidéo de cette semaine ne sont pas connus.',
    presence: {
      one: '{{count}} moment où deux pièces bougeaient en même temps',
      other: '{{count}} moments où deux pièces bougeaient en même temps',
    },
    presenceHint: 'Quelqu’un d’autre était peut-être là.',
    appointments: 'Rendez-vous',
    method: 'Élise ne reconnaît pas les personnes : les visites viennent du calendrier.',
    legendVisit: 'Visite',
    legendCall: 'Appel vidéo',
    legendPresence: 'Deux pièces à la fois',
  },
  alerts: {
    none: 'Aucune alerte cette semaine.',
    count: { one: '{{count}} alerte cette semaine', other: '{{count}} alertes cette semaine' },
    severity: { URGENT: 'Urgente', ATTENTION: 'À regarder', INFO: 'Information' },
    more: { one: 'et {{count}} autre', other: 'et {{count}} autres' },
  },
  sensors: {
    allGood: 'Tous les capteurs ont répondu cette semaine.',
    daysWithout: {
      one: '{{count}} jour sans aucune donnée',
      other: '{{count}} jours sans aucune donnée',
    },
    offline: 'Ne répond plus',
    lowBattery: 'Pile faible',
    noSignal: 'Aucun signal cette semaine',
    since: 'depuis le {{date}}',
  },
  statements: {
    wakeLater: 'Lever en moyenne {{duration}} plus tard que d’habitude (vers {{time}}).',
    wakeEarlier: 'Lever en moyenne {{duration}} plus tôt que d’habitude (vers {{time}}).',
    bedtimeLater: 'Coucher en moyenne {{duration}} plus tard que d’habitude (vers {{time}}).',
    bedtimeEarlier: 'Coucher en moyenne {{duration}} plus tôt que d’habitude (vers {{time}}).',
    inBedShorter: 'Nuits plus courtes : {{duration}} de moins en moyenne.',
    inBedLonger: 'Nuits plus longues : {{duration}} de plus en moyenne.',
    moreRisings:
      'Plus de levers la nuit : {{count}} par nuit en moyenne, contre {{usual}} d’habitude.',
    fewerRisings:
      'Moins de levers la nuit : {{count}} par nuit en moyenne, contre {{usual}} d’habitude.',
    moreMissedMeals: {
      one: '{{count}} repas sans activité en cuisine, contre {{usual}} d’habitude.',
      other: '{{count}} repas sans activité en cuisine, contre {{usual}} d’habitude.',
    },
    fewerMissedMeals: {
      one: 'Moins de repas sans activité en cuisine : {{count}}, contre {{usual}} d’habitude.',
      other: 'Moins de repas sans activité en cuisine : {{count}}, contre {{usual}} d’habitude.',
    },
    lessFridge: 'Réfrigérateur ouvert {{percent}} % moins souvent que d’habitude.',
    moreFridge: 'Réfrigérateur ouvert {{percent}} % plus souvent que d’habitude.',
    fewerOutings: {
      one: 'Moins de sorties : {{count}} cette semaine, contre {{usual}} d’habitude.',
      other: 'Moins de sorties : {{count}} cette semaine, contre {{usual}} d’habitude.',
    },
    moreOutings: {
      one: 'Plus de sorties : {{count}} cette semaine, contre {{usual}} d’habitude.',
      other: 'Plus de sorties : {{count}} cette semaine, contre {{usual}} d’habitude.',
    },
    fewerCalls: {
      one: 'Moins d’appels vidéo : {{count}} cette semaine, contre {{usual}} d’habitude.',
      other: 'Moins d’appels vidéo : {{count}} cette semaine, contre {{usual}} d’habitude.',
    },
    moreCalls: {
      one: 'Plus d’appels vidéo : {{count}} cette semaine, contre {{usual}} d’habitude.',
      other: 'Plus d’appels vidéo : {{count}} cette semaine, contre {{usual}} d’habitude.',
    },
    nightsStable: 'Les nuits ressemblent à celles des semaines précédentes.',
    mealsStable: 'Les repas suivent le rythme habituel.',
    outingsStable: 'Les sorties restent dans les habitudes.',
    noHistory:
      'C’est le premier bilan : la comparaison avec les habitudes viendra avec les semaines suivantes.',
    daysWithoutData: {
      one: '{{count}} jour sans données : les chiffres de la semaine sont incomplets.',
      other: '{{count}} jours sans données : les chiffres de la semaine sont incomplets.',
    },
    sensorIssues: {
      one: '{{count}} capteur a eu un souci : certains chiffres sont incomplets.',
      other: '{{count}} capteurs ont eu un souci : certains chiffres sont incomplets.',
    },
    summaryNoData: 'Pas assez de données cette semaine pour faire un bilan.',
    summaryFirst: 'Premier bilan : voici ce que les capteurs ont observé cette semaine.',
    summaryCalm: 'Une semaine calme, proche des habitudes.',
    summaryChanges: {
      one: 'Une semaine proche des habitudes, avec {{count}} changement à regarder.',
      other: '{{count}} changements par rapport aux habitudes cette semaine.',
    },
    summaryAlerts: {
      one: '{{count}} alerte urgente cette semaine : à regarder en premier.',
      other: '{{count}} alertes urgentes cette semaine : à regarder en premier.',
    },
  },
  pdf: {
    subtitle: 'Carnet de liaison Élise',
    audience: 'Document à partager avec le médecin ou l’infirmière',
    page: 'Page {{page}} sur {{pages}}',
    comparison: {
      one: 'Comparé à la semaine précédente.',
      other: 'Comparé aux {{count}} semaines précédentes.',
    },
    noComparison: 'Pas encore de semaine précédente pour comparer.',
  },
};

const en: WeeklyDigestTexts = {
  title: 'Weekly summary',
  eyebrow: 'Family notebook',
  period: 'From {{from}} to {{to}}',
  generatedOn: 'Created on {{date}} at {{time}}',
  disclaimer: 'Estimates from sensors, not a medical device.',
  advice: 'If you are worried, talk to the doctor or the nurse.',
  usual: 'Usually: {{value}}',
  thisWeek: 'This week',
  noData: 'No data',
  readySoon: 'This week’s summary will be ready on Sunday evening.',
  themes: {
    changes: 'What changed',
    nights: 'Nights',
    meals: 'Meals',
    outings: 'Outings',
    visits: 'Visits',
    alerts: 'Alerts',
    sensors: 'Sensors and data',
  },
  trend: {
    later: '{{duration}} later',
    earlier: '{{duration}} earlier',
    longer: '{{duration}} more',
    shorter: '{{duration}} less',
    more: 'More than usual',
    less: 'Less than usual',
    similar: 'As usual',
    noHistory: 'Usual pattern not known yet',
    watch: 'Worth a look',
  },
  nights: {
    bedtime: 'Bedtime',
    wake: 'Getting up',
    inBed: 'Time in bed',
    inBedEstimated: 'Night length',
    risings: 'Getting up at night',
    perNight: '{{count}} per night',
    sourceBed: 'Measured by the bed sensor.',
    sourceMotion: 'Estimated from movements in the home.',
    restless: { one: '{{count}} more restless night', other: '{{count}} more restless nights' },
    short: {
      one: '{{count}} night shorter than usual',
      other: '{{count}} nights shorter than usual',
    },
    calm: 'No night more restless than usual.',
    notEquipped: 'No sensor can follow the nights.',
    noData: 'No data about the nights this week.',
    partial: { one: '{{count}} night without data', other: '{{count}} nights without data' },
    legendBar: 'From bedtime to getting up',
    legendUsual: 'Usual time to get up',
  },
  meals: {
    names: { BREAKFAST: 'Breakfast', LUNCH: 'Lunch', DINNER: 'Dinner' },
    rows: { BREAKFAST: 'Morning', LUNCH: 'Noon', DINNER: 'Evening' },
    seen: 'Activity in the kitchen',
    notSeen: 'No activity seen',
    unknown: 'No data',
    seenCount: {
      one: '{{count}} meal with activity in the kitchen',
      other: '{{count}} meals with activity in the kitchen',
    },
    missed: { one: '{{count}} meal seems missed', other: '{{count}} meals seem missed' },
    noneMissed: 'No meal seems missed.',
    fridge: 'Fridge opened {{count}} times a day on average',
    seenLabel: 'Meals with activity',
    missedLabel: 'Seem missed',
    fridgeLabel: 'Fridge',
    perDay: '{{count}} / day',
    method: 'Activity in the kitchen and at the fridge at meal times.',
    notEquipped: 'No sensor in the kitchen or on the fridge.',
    noData: 'No data about meals this week.',
  },
  outings: {
    label: 'Probable outings',
    count: { one: '{{count}} outing', other: '{{count}} outings' },
    timeLabel: 'Time outside',
    daysWithoutLabel: 'Days without going out',
    duration: '{{duration}} outside in total',
    daysWithout: {
      one: '{{count}} day without going out',
      other: '{{count}} days without going out',
    },
    everyDay: 'At least one outing every day.',
    legend: 'Height: time outside, number: outings',
    method: 'Estimated from the front door and no movement inside.',
    notEquipped: 'The front door has no sensor: outings are not followed.',
    noData: 'No data about outings this week.',
  },
  visits: {
    planned: {
      one: '{{count}} visit in the calendar',
      other: '{{count}} visits in the calendar',
    },
    confirmed: {
      one: 'including {{count}} confirmed in the notebook',
      other: 'including {{count}} confirmed in the notebook',
    },
    nonePlanned: 'No visit planned in the calendar.',
    plannedLabel: 'Visits in the calendar',
    callsLabel: 'Video calls',
    presenceLabel: 'Two rooms at once',
    calls: { one: '{{count}} video call on the TV', other: '{{count}} video calls on the TV' },
    callsDuration: '{{duration}} in total',
    callsUnknown: 'This week’s video calls are not known.',
    presence: {
      one: '{{count}} moment when two rooms moved at the same time',
      other: '{{count}} moments when two rooms moved at the same time',
    },
    presenceHint: 'Someone else was maybe there.',
    appointments: 'Appointments',
    method: 'Élise does not recognise people: visits come from the calendar.',
    legendVisit: 'Visit',
    legendCall: 'Video call',
    legendPresence: 'Two rooms at once',
  },
  alerts: {
    none: 'No alert this week.',
    count: { one: '{{count}} alert this week', other: '{{count}} alerts this week' },
    severity: { URGENT: 'Urgent', ATTENTION: 'To look at', INFO: 'Information' },
    more: { one: 'and {{count}} more', other: 'and {{count}} more' },
  },
  sensors: {
    allGood: 'Every sensor answered this week.',
    daysWithout: {
      one: '{{count}} day without any data',
      other: '{{count}} days without any data',
    },
    offline: 'Not answering',
    lowBattery: 'Low battery',
    noSignal: 'No signal this week',
    since: 'since {{date}}',
  },
  statements: {
    wakeLater: 'Getting up {{duration}} later than usual on average (around {{time}}).',
    wakeEarlier: 'Getting up {{duration}} earlier than usual on average (around {{time}}).',
    bedtimeLater: 'Going to bed {{duration}} later than usual on average (around {{time}}).',
    bedtimeEarlier: 'Going to bed {{duration}} earlier than usual on average (around {{time}}).',
    inBedShorter: 'Shorter nights: {{duration}} less on average.',
    inBedLonger: 'Longer nights: {{duration}} more on average.',
    moreRisings:
      'Getting up more at night: {{count}} times per night on average, against {{usual}} usually.',
    fewerRisings:
      'Getting up less at night: {{count}} times per night on average, against {{usual}} usually.',
    moreMissedMeals: {
      one: '{{count}} meal without activity in the kitchen, against {{usual}} usually.',
      other: '{{count}} meals without activity in the kitchen, against {{usual}} usually.',
    },
    fewerMissedMeals: {
      one: 'Fewer meals without activity in the kitchen: {{count}}, against {{usual}} usually.',
      other: 'Fewer meals without activity in the kitchen: {{count}}, against {{usual}} usually.',
    },
    lessFridge: 'Fridge opened {{percent}}% less often than usual.',
    moreFridge: 'Fridge opened {{percent}}% more often than usual.',
    fewerOutings: {
      one: 'Fewer outings: {{count}} this week, against {{usual}} usually.',
      other: 'Fewer outings: {{count}} this week, against {{usual}} usually.',
    },
    moreOutings: {
      one: 'More outings: {{count}} this week, against {{usual}} usually.',
      other: 'More outings: {{count}} this week, against {{usual}} usually.',
    },
    fewerCalls: {
      one: 'Fewer video calls: {{count}} this week, against {{usual}} usually.',
      other: 'Fewer video calls: {{count}} this week, against {{usual}} usually.',
    },
    moreCalls: {
      one: 'More video calls: {{count}} this week, against {{usual}} usually.',
      other: 'More video calls: {{count}} this week, against {{usual}} usually.',
    },
    nightsStable: 'The nights look like those of the previous weeks.',
    mealsStable: 'Meals follow the usual rhythm.',
    outingsStable: 'Outings stay within the usual habits.',
    noHistory: 'This is the first summary: the comparison with habits will come in the next weeks.',
    daysWithoutData: {
      one: '{{count}} day without data: this week’s figures are incomplete.',
      other: '{{count}} days without data: this week’s figures are incomplete.',
    },
    sensorIssues: {
      one: '{{count}} sensor had a problem: some figures are incomplete.',
      other: '{{count}} sensors had a problem: some figures are incomplete.',
    },
    summaryNoData: 'Not enough data this week to make a summary.',
    summaryFirst: 'First summary: here is what the sensors observed this week.',
    summaryCalm: 'A calm week, close to the usual habits.',
    summaryChanges: {
      one: 'A week close to the usual habits, with {{count}} change to look at.',
      other: '{{count}} changes from the usual habits this week.',
    },
    summaryAlerts: {
      one: '{{count}} urgent alert this week: look at it first.',
      other: '{{count}} urgent alerts this week: look at them first.',
    },
  },
  pdf: {
    subtitle: 'Élise family notebook',
    audience: 'Document to share with the doctor or the nurse',
    page: 'Page {{page}} of {{pages}}',
    comparison: {
      one: 'Compared with the previous week.',
      other: 'Compared with the {{count}} previous weeks.',
    },
    noComparison: 'No previous week to compare with yet.',
  },
};

const es: WeeklyDigestTexts = {
  title: 'Resumen de la semana',
  eyebrow: 'Cuaderno de enlace',
  period: 'Del {{from}} al {{to}}',
  generatedOn: 'Generado el {{date}} a las {{time}}',
  disclaimer: 'Estimaciones obtenidas de sensores, no es un dispositivo médico.',
  advice: 'Si algo le preocupa, háblelo con el médico o la enfermera.',
  usual: 'Lo habitual: {{value}}',
  thisWeek: 'Esta semana',
  noData: 'Sin datos',
  readySoon: 'El resumen de esta semana estará listo el domingo por la noche.',
  themes: {
    changes: 'Lo que ha cambiado',
    nights: 'Las noches',
    meals: 'Las comidas',
    outings: 'Las salidas',
    visits: 'Las visitas',
    alerts: 'Las alertas',
    sensors: 'Sensores y datos',
  },
  trend: {
    later: '{{duration}} más tarde',
    earlier: '{{duration}} más temprano',
    longer: '{{duration}} más',
    shorter: '{{duration}} menos',
    more: 'Más de lo habitual',
    less: 'Menos de lo habitual',
    similar: 'Como de costumbre',
    noHistory: 'Costumbre aún desconocida',
    watch: 'A revisar',
  },
  nights: {
    bedtime: 'Acostarse',
    wake: 'Levantarse',
    inBed: 'Tiempo en la cama',
    inBedEstimated: 'Duración de la noche',
    risings: 'Levantadas por la noche',
    perNight: '{{count}} por noche',
    sourceBed: 'Medido por el sensor de la cama.',
    sourceMotion: 'Estimado a partir de los movimientos en la vivienda.',
    restless: { one: '{{count}} noche más agitada', other: '{{count}} noches más agitadas' },
    short: {
      one: '{{count}} noche más corta de lo habitual',
      other: '{{count}} noches más cortas de lo habitual',
    },
    calm: 'Ninguna noche más agitada de lo habitual.',
    notEquipped: 'Ningún sensor permite seguir las noches.',
    noData: 'No hay datos sobre las noches esta semana.',
    partial: { one: '{{count}} noche sin datos', other: '{{count}} noches sin datos' },
    legendBar: 'De acostarse a levantarse',
    legendUsual: 'Hora habitual de levantarse',
  },
  meals: {
    names: { BREAKFAST: 'Desayuno', LUNCH: 'Comida', DINNER: 'Cena' },
    rows: { BREAKFAST: 'Mañana', LUNCH: 'Mediodía', DINNER: 'Noche' },
    seen: 'Actividad en la cocina',
    notSeen: 'Sin actividad vista',
    unknown: 'Sin datos',
    seenCount: {
      one: '{{count}} comida con actividad en la cocina',
      other: '{{count}} comidas con actividad en la cocina',
    },
    missed: {
      one: '{{count}} comida parece saltada',
      other: '{{count}} comidas parecen saltadas',
    },
    noneMissed: 'Ninguna comida parece saltada.',
    fridge: 'Nevera abierta {{count}} veces al día de media',
    seenLabel: 'Comidas con actividad',
    missedLabel: 'Parecen saltadas',
    fridgeLabel: 'Nevera',
    perDay: '{{count}} / día',
    method: 'Actividad en la cocina y en la nevera a las horas de las comidas.',
    notEquipped: 'No hay sensor en la cocina ni en la nevera.',
    noData: 'No hay datos sobre las comidas esta semana.',
  },
  outings: {
    label: 'Salidas probables',
    count: { one: '{{count}} salida', other: '{{count}} salidas' },
    timeLabel: 'Tiempo fuera',
    daysWithoutLabel: 'Días sin salir',
    duration: '{{duration}} fuera en total',
    daysWithout: { one: '{{count}} día sin salir', other: '{{count}} días sin salir' },
    everyDay: 'Al menos una salida cada día.',
    legend: 'Altura: tiempo fuera, cifra: número de salidas',
    method: 'Estimadas con la puerta de entrada y la ausencia de movimiento en el interior.',
    notEquipped: 'La puerta de entrada no tiene sensor: las salidas no se siguen.',
    noData: 'No hay datos sobre las salidas esta semana.',
  },
  visits: {
    planned: {
      one: '{{count}} visita en el calendario',
      other: '{{count}} visitas en el calendario',
    },
    confirmed: {
      one: 'de ellas {{count}} confirmada en el cuaderno',
      other: 'de ellas {{count}} confirmadas en el cuaderno',
    },
    nonePlanned: 'Ninguna visita prevista en el calendario.',
    plannedLabel: 'Visitas en el calendario',
    callsLabel: 'Videollamadas',
    presenceLabel: 'Dos habitaciones a la vez',
    calls: {
      one: '{{count}} videollamada en la tele',
      other: '{{count}} videollamadas en la tele',
    },
    callsDuration: '{{duration}} en total',
    callsUnknown: 'No se conocen las videollamadas de esta semana.',
    presence: {
      one: '{{count}} momento en que dos habitaciones se movían a la vez',
      other: '{{count}} momentos en que dos habitaciones se movían a la vez',
    },
    presenceHint: 'Quizá había otra persona.',
    appointments: 'Citas',
    method: 'Élise no reconoce a las personas: las visitas vienen del calendario.',
    legendVisit: 'Visita',
    legendCall: 'Videollamada',
    legendPresence: 'Dos habitaciones a la vez',
  },
  alerts: {
    none: 'Ninguna alerta esta semana.',
    count: { one: '{{count}} alerta esta semana', other: '{{count}} alertas esta semana' },
    severity: { URGENT: 'Urgente', ATTENTION: 'A revisar', INFO: 'Información' },
    more: { one: 'y {{count}} más', other: 'y {{count}} más' },
  },
  sensors: {
    allGood: 'Todos los sensores respondieron esta semana.',
    daysWithout: { one: '{{count}} día sin ningún dato', other: '{{count}} días sin ningún dato' },
    offline: 'No responde',
    lowBattery: 'Pila baja',
    noSignal: 'Sin señal esta semana',
    since: 'desde el {{date}}',
  },
  statements: {
    wakeLater: 'Se levanta de media {{duration}} más tarde de lo habitual (hacia las {{time}}).',
    wakeEarlier:
      'Se levanta de media {{duration}} más temprano de lo habitual (hacia las {{time}}).',
    bedtimeLater: 'Se acuesta de media {{duration}} más tarde de lo habitual (hacia las {{time}}).',
    bedtimeEarlier:
      'Se acuesta de media {{duration}} más temprano de lo habitual (hacia las {{time}}).',
    inBedShorter: 'Noches más cortas: {{duration}} menos de media.',
    inBedLonger: 'Noches más largas: {{duration}} más de media.',
    moreRisings:
      'Más levantadas por la noche: {{count}} por noche de media, frente a {{usual}} lo habitual.',
    fewerRisings:
      'Menos levantadas por la noche: {{count}} por noche de media, frente a {{usual}} lo habitual.',
    moreMissedMeals: {
      one: '{{count}} comida sin actividad en la cocina, frente a {{usual}} lo habitual.',
      other: '{{count}} comidas sin actividad en la cocina, frente a {{usual}} lo habitual.',
    },
    fewerMissedMeals: {
      one: 'Menos comidas sin actividad en la cocina: {{count}}, frente a {{usual}} lo habitual.',
      other: 'Menos comidas sin actividad en la cocina: {{count}}, frente a {{usual}} lo habitual.',
    },
    lessFridge: 'Nevera abierta un {{percent}} % menos que de costumbre.',
    moreFridge: 'Nevera abierta un {{percent}} % más que de costumbre.',
    fewerOutings: {
      one: 'Menos salidas: {{count}} esta semana, frente a {{usual}} lo habitual.',
      other: 'Menos salidas: {{count}} esta semana, frente a {{usual}} lo habitual.',
    },
    moreOutings: {
      one: 'Más salidas: {{count}} esta semana, frente a {{usual}} lo habitual.',
      other: 'Más salidas: {{count}} esta semana, frente a {{usual}} lo habitual.',
    },
    fewerCalls: {
      one: 'Menos videollamadas: {{count}} esta semana, frente a {{usual}} lo habitual.',
      other: 'Menos videollamadas: {{count}} esta semana, frente a {{usual}} lo habitual.',
    },
    moreCalls: {
      one: 'Más videollamadas: {{count}} esta semana, frente a {{usual}} lo habitual.',
      other: 'Más videollamadas: {{count}} esta semana, frente a {{usual}} lo habitual.',
    },
    nightsStable: 'Las noches se parecen a las de las semanas anteriores.',
    mealsStable: 'Las comidas siguen el ritmo habitual.',
    outingsStable: 'Las salidas siguen dentro de lo habitual.',
    noHistory:
      'Es el primer resumen: la comparación con las costumbres llegará en las próximas semanas.',
    daysWithoutData: {
      one: '{{count}} día sin datos: las cifras de la semana están incompletas.',
      other: '{{count}} días sin datos: las cifras de la semana están incompletas.',
    },
    sensorIssues: {
      one: '{{count}} sensor tuvo un problema: algunas cifras están incompletas.',
      other: '{{count}} sensores tuvieron un problema: algunas cifras están incompletas.',
    },
    summaryNoData: 'No hay datos suficientes esta semana para hacer un resumen.',
    summaryFirst: 'Primer resumen: esto es lo que los sensores observaron esta semana.',
    summaryCalm: 'Una semana tranquila, parecida a lo habitual.',
    summaryChanges: {
      one: 'Una semana parecida a lo habitual, con {{count}} cambio que revisar.',
      other: '{{count}} cambios respecto a lo habitual esta semana.',
    },
    summaryAlerts: {
      one: '{{count}} alerta urgente esta semana: revísela primero.',
      other: '{{count}} alertas urgentes esta semana: revíselas primero.',
    },
  },
  pdf: {
    subtitle: 'Cuaderno de enlace Élise',
    audience: 'Documento para compartir con el médico o la enfermera',
    page: 'Página {{page}} de {{pages}}',
    comparison: {
      one: 'Comparado con la semana anterior.',
      other: 'Comparado con las {{count}} semanas anteriores.',
    },
    noComparison: 'Aún no hay semana anterior para comparar.',
  },
};

const it: WeeklyDigestTexts = {
  title: 'Resoconto della settimana',
  eyebrow: 'Quaderno di collegamento',
  period: 'Dal {{from}} al {{to}}',
  generatedOn: 'Generato il {{date}} alle {{time}}',
  disclaimer: 'Stime ricavate dai sensori, non è un dispositivo medico.',
  advice: 'In caso di dubbio, parlatene con il medico o l’infermiera.',
  usual: 'Di solito: {{value}}',
  thisWeek: 'Questa settimana',
  noData: 'Nessun dato',
  readySoon: 'Il resoconto di questa settimana sarà pronto domenica sera.',
  themes: {
    changes: 'Cosa è cambiato',
    nights: 'Le notti',
    meals: 'I pasti',
    outings: 'Le uscite',
    visits: 'Le visite',
    alerts: 'Gli avvisi',
    sensors: 'Sensori e dati',
  },
  trend: {
    later: '{{duration}} più tardi',
    earlier: '{{duration}} prima',
    longer: '{{duration}} in più',
    shorter: '{{duration}} in meno',
    more: 'Più del solito',
    less: 'Meno del solito',
    similar: 'Come al solito',
    noHistory: 'Abitudine non ancora nota',
    watch: 'Da guardare',
  },
  nights: {
    bedtime: 'Coricarsi',
    wake: 'Alzarsi',
    inBed: 'Tempo a letto',
    inBedEstimated: 'Durata della notte',
    risings: 'Alzate notturne',
    perNight: '{{count}} per notte',
    sourceBed: 'Misurato dal sensore del letto.',
    sourceMotion: 'Stimato dai movimenti nell’abitazione.',
    restless: { one: '{{count}} notte più agitata', other: '{{count}} notti più agitate' },
    short: {
      one: '{{count}} notte più corta del solito',
      other: '{{count}} notti più corte del solito',
    },
    calm: 'Nessuna notte più agitata del solito.',
    notEquipped: 'Nessun sensore permette di seguire le notti.',
    noData: 'Nessun dato sulle notti questa settimana.',
    partial: { one: '{{count}} notte senza dati', other: '{{count}} notti senza dati' },
    legendBar: 'Da quando si corica a quando si alza',
    legendUsual: 'Ora abituale in cui si alza',
  },
  meals: {
    names: { BREAKFAST: 'Colazione', LUNCH: 'Pranzo', DINNER: 'Cena' },
    rows: { BREAKFAST: 'Mattina', LUNCH: 'Mezzogiorno', DINNER: 'Sera' },
    seen: 'Attività in cucina',
    notSeen: 'Nessuna attività vista',
    unknown: 'Nessun dato',
    seenCount: {
      one: '{{count}} pasto con attività in cucina',
      other: '{{count}} pasti con attività in cucina',
    },
    missed: { one: '{{count}} pasto sembra saltato', other: '{{count}} pasti sembrano saltati' },
    noneMissed: 'Nessun pasto sembra saltato.',
    fridge: 'Frigorifero aperto {{count}} volte al giorno in media',
    seenLabel: 'Pasti con attività',
    missedLabel: 'Sembrano saltati',
    fridgeLabel: 'Frigorifero',
    perDay: '{{count}} / giorno',
    method: 'Attività in cucina e al frigorifero all’ora dei pasti.',
    notEquipped: 'Nessun sensore in cucina né sul frigorifero.',
    noData: 'Nessun dato sui pasti questa settimana.',
  },
  outings: {
    label: 'Uscite probabili',
    count: { one: '{{count}} uscita', other: '{{count}} uscite' },
    timeLabel: 'Tempo fuori',
    daysWithoutLabel: 'Giorni senza uscire',
    duration: '{{duration}} fuori in totale',
    daysWithout: { one: '{{count}} giorno senza uscire', other: '{{count}} giorni senza uscire' },
    everyDay: 'Almeno un’uscita ogni giorno.',
    legend: 'Altezza: tempo fuori, numero: uscite',
    method: 'Stimate con la porta d’ingresso e l’assenza di movimento all’interno.',
    notEquipped: 'La porta d’ingresso non ha sensore: le uscite non sono seguite.',
    noData: 'Nessun dato sulle uscite questa settimana.',
  },
  visits: {
    planned: {
      one: '{{count}} visita nel calendario',
      other: '{{count}} visite nel calendario',
    },
    confirmed: {
      one: 'di cui {{count}} confermata nel quaderno',
      other: 'di cui {{count}} confermate nel quaderno',
    },
    nonePlanned: 'Nessuna visita prevista nel calendario.',
    plannedLabel: 'Visite nel calendario',
    callsLabel: 'Videochiamate',
    presenceLabel: 'Due stanze insieme',
    calls: {
      one: '{{count}} videochiamata sulla TV',
      other: '{{count}} videochiamate sulla TV',
    },
    callsDuration: '{{duration}} in totale',
    callsUnknown: 'Le videochiamate di questa settimana non sono note.',
    presence: {
      one: '{{count}} momento in cui due stanze si muovevano insieme',
      other: '{{count}} momenti in cui due stanze si muovevano insieme',
    },
    presenceHint: 'Forse c’era qualcun altro.',
    appointments: 'Appuntamenti',
    method: 'Élise non riconosce le persone: le visite vengono dal calendario.',
    legendVisit: 'Visita',
    legendCall: 'Videochiamata',
    legendPresence: 'Due stanze insieme',
  },
  alerts: {
    none: 'Nessun avviso questa settimana.',
    count: { one: '{{count}} avviso questa settimana', other: '{{count}} avvisi questa settimana' },
    severity: { URGENT: 'Urgente', ATTENTION: 'Da guardare', INFO: 'Informazione' },
    more: { one: 'e {{count}} altro', other: 'e altri {{count}}' },
  },
  sensors: {
    allGood: 'Tutti i sensori hanno risposto questa settimana.',
    daysWithout: {
      one: '{{count}} giorno senza alcun dato',
      other: '{{count}} giorni senza alcun dato',
    },
    offline: 'Non risponde',
    lowBattery: 'Batteria scarica',
    noSignal: 'Nessun segnale questa settimana',
    since: 'dal {{date}}',
  },
  statements: {
    wakeLater: 'Si alza in media {{duration}} più tardi del solito (verso le {{time}}).',
    wakeEarlier: 'Si alza in media {{duration}} prima del solito (verso le {{time}}).',
    bedtimeLater: 'Va a letto in media {{duration}} più tardi del solito (verso le {{time}}).',
    bedtimeEarlier: 'Va a letto in media {{duration}} prima del solito (verso le {{time}}).',
    inBedShorter: 'Notti più corte: {{duration}} in meno in media.',
    inBedLonger: 'Notti più lunghe: {{duration}} in più in media.',
    moreRisings: 'Più alzate notturne: {{count}} per notte in media, contro {{usual}} di solito.',
    fewerRisings: 'Meno alzate notturne: {{count}} per notte in media, contro {{usual}} di solito.',
    moreMissedMeals: {
      one: '{{count}} pasto senza attività in cucina, contro {{usual}} di solito.',
      other: '{{count}} pasti senza attività in cucina, contro {{usual}} di solito.',
    },
    fewerMissedMeals: {
      one: 'Meno pasti senza attività in cucina: {{count}}, contro {{usual}} di solito.',
      other: 'Meno pasti senza attività in cucina: {{count}}, contro {{usual}} di solito.',
    },
    lessFridge: 'Frigorifero aperto il {{percent}} % in meno del solito.',
    moreFridge: 'Frigorifero aperto il {{percent}} % in più del solito.',
    fewerOutings: {
      one: 'Meno uscite: {{count}} questa settimana, contro {{usual}} di solito.',
      other: 'Meno uscite: {{count}} questa settimana, contro {{usual}} di solito.',
    },
    moreOutings: {
      one: 'Più uscite: {{count}} questa settimana, contro {{usual}} di solito.',
      other: 'Più uscite: {{count}} questa settimana, contro {{usual}} di solito.',
    },
    fewerCalls: {
      one: 'Meno videochiamate: {{count}} questa settimana, contro {{usual}} di solito.',
      other: 'Meno videochiamate: {{count}} questa settimana, contro {{usual}} di solito.',
    },
    moreCalls: {
      one: 'Più videochiamate: {{count}} questa settimana, contro {{usual}} di solito.',
      other: 'Più videochiamate: {{count}} questa settimana, contro {{usual}} di solito.',
    },
    nightsStable: 'Le notti somigliano a quelle delle settimane precedenti.',
    mealsStable: 'I pasti seguono il ritmo abituale.',
    outingsStable: 'Le uscite restano nelle abitudini.',
    noHistory:
      'È il primo resoconto: il confronto con le abitudini arriverà nelle prossime settimane.',
    daysWithoutData: {
      one: '{{count}} giorno senza dati: le cifre della settimana sono incomplete.',
      other: '{{count}} giorni senza dati: le cifre della settimana sono incomplete.',
    },
    sensorIssues: {
      one: '{{count}} sensore ha avuto un problema: alcune cifre sono incomplete.',
      other: '{{count}} sensori hanno avuto un problema: alcune cifre sono incomplete.',
    },
    summaryNoData: 'Dati insufficienti questa settimana per fare un resoconto.',
    summaryFirst: 'Primo resoconto: ecco cosa hanno osservato i sensori questa settimana.',
    summaryCalm: 'Una settimana tranquilla, vicina alle abitudini.',
    summaryChanges: {
      one: 'Una settimana vicina alle abitudini, con {{count}} cambiamento da guardare.',
      other: '{{count}} cambiamenti rispetto alle abitudini questa settimana.',
    },
    summaryAlerts: {
      one: '{{count}} avviso urgente questa settimana: da guardare per primo.',
      other: '{{count}} avvisi urgenti questa settimana: da guardare per primi.',
    },
  },
  pdf: {
    subtitle: 'Quaderno di collegamento Élise',
    audience: 'Documento da condividere con il medico o l’infermiera',
    page: 'Pagina {{page}} di {{pages}}',
    comparison: {
      one: 'Confrontato con la settimana precedente.',
      other: 'Confrontato con le {{count}} settimane precedenti.',
    },
    noComparison: 'Ancora nessuna settimana precedente per il confronto.',
  },
};

const pt: WeeklyDigestTexts = {
  title: 'Resumo da semana',
  eyebrow: 'Caderno de ligação',
  period: 'De {{from}} a {{to}}',
  generatedOn: 'Gerado a {{date}} às {{time}}',
  disclaimer: 'Estimativas obtidas por sensores, não é um dispositivo médico.',
  advice: 'Em caso de preocupação, fale com o médico ou a enfermeira.',
  usual: 'Habitualmente: {{value}}',
  thisWeek: 'Esta semana',
  noData: 'Sem dados',
  readySoon: 'O resumo desta semana estará pronto no domingo à noite.',
  themes: {
    changes: 'O que mudou',
    nights: 'As noites',
    meals: 'As refeições',
    outings: 'As saídas',
    visits: 'As visitas',
    alerts: 'Os alertas',
    sensors: 'Sensores e dados',
  },
  trend: {
    later: '{{duration}} mais tarde',
    earlier: '{{duration}} mais cedo',
    longer: '{{duration}} a mais',
    shorter: '{{duration}} a menos',
    more: 'Mais do que o habitual',
    less: 'Menos do que o habitual',
    similar: 'Como habitualmente',
    noHistory: 'Hábito ainda desconhecido',
    watch: 'A ver',
  },
  nights: {
    bedtime: 'Deitar',
    wake: 'Levantar',
    inBed: 'Tempo na cama',
    inBedEstimated: 'Duração da noite',
    risings: 'Levantes à noite',
    perNight: '{{count}} por noite',
    sourceBed: 'Medido pelo sensor da cama.',
    sourceMotion: 'Estimado a partir dos movimentos na habitação.',
    restless: { one: '{{count}} noite mais agitada', other: '{{count}} noites mais agitadas' },
    short: {
      one: '{{count}} noite mais curta do que o habitual',
      other: '{{count}} noites mais curtas do que o habitual',
    },
    calm: 'Nenhuma noite mais agitada do que o habitual.',
    notEquipped: 'Nenhum sensor permite seguir as noites.',
    noData: 'Sem dados sobre as noites esta semana.',
    partial: { one: '{{count}} noite sem dados', other: '{{count}} noites sem dados' },
    legendBar: 'Do deitar ao levantar',
    legendUsual: 'Hora habitual de levantar',
  },
  meals: {
    names: { BREAKFAST: 'Pequeno-almoço', LUNCH: 'Almoço', DINNER: 'Jantar' },
    rows: { BREAKFAST: 'Manhã', LUNCH: 'Meio-dia', DINNER: 'Noite' },
    seen: 'Atividade na cozinha',
    notSeen: 'Nenhuma atividade vista',
    unknown: 'Sem dados',
    seenCount: {
      one: '{{count}} refeição com atividade na cozinha',
      other: '{{count}} refeições com atividade na cozinha',
    },
    missed: {
      one: '{{count}} refeição parece falhada',
      other: '{{count}} refeições parecem falhadas',
    },
    noneMissed: 'Nenhuma refeição parece falhada.',
    fridge: 'Frigorífico aberto {{count}} vezes por dia em média',
    seenLabel: 'Refeições com atividade',
    missedLabel: 'Parecem falhadas',
    fridgeLabel: 'Frigorífico',
    perDay: '{{count}} / dia',
    method: 'Atividade na cozinha e no frigorífico às horas das refeições.',
    notEquipped: 'Nenhum sensor na cozinha nem no frigorífico.',
    noData: 'Sem dados sobre as refeições esta semana.',
  },
  outings: {
    label: 'Saídas prováveis',
    count: { one: '{{count}} saída', other: '{{count}} saídas' },
    timeLabel: 'Tempo fora',
    daysWithoutLabel: 'Dias sem sair',
    duration: '{{duration}} fora no total',
    daysWithout: { one: '{{count}} dia sem sair', other: '{{count}} dias sem sair' },
    everyDay: 'Pelo menos uma saída por dia.',
    legend: 'Altura: tempo fora, número: saídas',
    method: 'Estimadas com a porta de entrada e a ausência de movimento no interior.',
    notEquipped: 'A porta de entrada não tem sensor: as saídas não são seguidas.',
    noData: 'Sem dados sobre as saídas esta semana.',
  },
  visits: {
    planned: {
      one: '{{count}} visita no calendário',
      other: '{{count}} visitas no calendário',
    },
    confirmed: {
      one: 'das quais {{count}} confirmada no caderno',
      other: 'das quais {{count}} confirmadas no caderno',
    },
    nonePlanned: 'Nenhuma visita prevista no calendário.',
    plannedLabel: 'Visitas no calendário',
    callsLabel: 'Videochamadas',
    presenceLabel: 'Duas divisões ao mesmo tempo',
    calls: {
      one: '{{count}} videochamada na televisão',
      other: '{{count}} videochamadas na televisão',
    },
    callsDuration: '{{duration}} no total',
    callsUnknown: 'As videochamadas desta semana não são conhecidas.',
    presence: {
      one: '{{count}} momento em que duas divisões se mexiam ao mesmo tempo',
      other: '{{count}} momentos em que duas divisões se mexiam ao mesmo tempo',
    },
    presenceHint: 'Talvez estivesse outra pessoa.',
    appointments: 'Consultas',
    method: 'A Élise não reconhece as pessoas: as visitas vêm do calendário.',
    legendVisit: 'Visita',
    legendCall: 'Videochamada',
    legendPresence: 'Duas divisões ao mesmo tempo',
  },
  alerts: {
    none: 'Nenhum alerta esta semana.',
    count: { one: '{{count}} alerta esta semana', other: '{{count}} alertas esta semana' },
    severity: { URGENT: 'Urgente', ATTENTION: 'A ver', INFO: 'Informação' },
    more: { one: 'e mais {{count}}', other: 'e mais {{count}}' },
  },
  sensors: {
    allGood: 'Todos os sensores responderam esta semana.',
    daysWithout: { one: '{{count}} dia sem nenhum dado', other: '{{count}} dias sem nenhum dado' },
    offline: 'Não responde',
    lowBattery: 'Pilha fraca',
    noSignal: 'Sem sinal esta semana',
    since: 'desde {{date}}',
  },
  statements: {
    wakeLater:
      'Levanta-se em média {{duration}} mais tarde do que o habitual (por volta das {{time}}).',
    wakeEarlier:
      'Levanta-se em média {{duration}} mais cedo do que o habitual (por volta das {{time}}).',
    bedtimeLater:
      'Deita-se em média {{duration}} mais tarde do que o habitual (por volta das {{time}}).',
    bedtimeEarlier:
      'Deita-se em média {{duration}} mais cedo do que o habitual (por volta das {{time}}).',
    inBedShorter: 'Noites mais curtas: {{duration}} a menos em média.',
    inBedLonger: 'Noites mais longas: {{duration}} a mais em média.',
    moreRisings:
      'Mais levantes à noite: {{count}} por noite em média, contra {{usual}} habitualmente.',
    fewerRisings:
      'Menos levantes à noite: {{count}} por noite em média, contra {{usual}} habitualmente.',
    moreMissedMeals: {
      one: '{{count}} refeição sem atividade na cozinha, contra {{usual}} habitualmente.',
      other: '{{count}} refeições sem atividade na cozinha, contra {{usual}} habitualmente.',
    },
    fewerMissedMeals: {
      one: 'Menos refeições sem atividade na cozinha: {{count}}, contra {{usual}} habitualmente.',
      other: 'Menos refeições sem atividade na cozinha: {{count}}, contra {{usual}} habitualmente.',
    },
    lessFridge: 'Frigorífico aberto {{percent}} % menos vezes do que o habitual.',
    moreFridge: 'Frigorífico aberto {{percent}} % mais vezes do que o habitual.',
    fewerOutings: {
      one: 'Menos saídas: {{count}} esta semana, contra {{usual}} habitualmente.',
      other: 'Menos saídas: {{count}} esta semana, contra {{usual}} habitualmente.',
    },
    moreOutings: {
      one: 'Mais saídas: {{count}} esta semana, contra {{usual}} habitualmente.',
      other: 'Mais saídas: {{count}} esta semana, contra {{usual}} habitualmente.',
    },
    fewerCalls: {
      one: 'Menos videochamadas: {{count}} esta semana, contra {{usual}} habitualmente.',
      other: 'Menos videochamadas: {{count}} esta semana, contra {{usual}} habitualmente.',
    },
    moreCalls: {
      one: 'Mais videochamadas: {{count}} esta semana, contra {{usual}} habitualmente.',
      other: 'Mais videochamadas: {{count}} esta semana, contra {{usual}} habitualmente.',
    },
    nightsStable: 'As noites parecem-se com as das semanas anteriores.',
    mealsStable: 'As refeições seguem o ritmo habitual.',
    outingsStable: 'As saídas continuam dentro dos hábitos.',
    noHistory: 'É o primeiro resumo: a comparação com os hábitos virá nas próximas semanas.',
    daysWithoutData: {
      one: '{{count}} dia sem dados: os números da semana estão incompletos.',
      other: '{{count}} dias sem dados: os números da semana estão incompletos.',
    },
    sensorIssues: {
      one: '{{count}} sensor teve um problema: alguns números estão incompletos.',
      other: '{{count}} sensores tiveram um problema: alguns números estão incompletos.',
    },
    summaryNoData: 'Não há dados suficientes esta semana para fazer um resumo.',
    summaryFirst: 'Primeiro resumo: eis o que os sensores observaram esta semana.',
    summaryCalm: 'Uma semana calma, próxima dos hábitos.',
    summaryChanges: {
      one: 'Uma semana próxima dos hábitos, com {{count}} mudança a ver.',
      other: '{{count}} mudanças em relação aos hábitos esta semana.',
    },
    summaryAlerts: {
      one: '{{count}} alerta urgente esta semana: veja-o primeiro.',
      other: '{{count}} alertas urgentes esta semana: veja-os primeiro.',
    },
  },
  pdf: {
    subtitle: 'Caderno de ligação Élise',
    audience: 'Documento para partilhar com o médico ou a enfermeira',
    page: 'Página {{page}} de {{pages}}',
    comparison: {
      one: 'Comparado com a semana anterior.',
      other: 'Comparado com as {{count}} semanas anteriores.',
    },
    noComparison: 'Ainda não há semana anterior para comparar.',
  },
};

export const WEEKLY_DIGEST_TEXTS: Record<WeeklyDigestLanguage, WeeklyDigestTexts> = {
  fr,
  en,
  es,
  it,
  pt,
};

const DATE_LOCALES: Record<WeeklyDigestLanguage, string> = {
  fr: 'fr-FR',
  en: 'en-GB',
  es: 'es-ES',
  it: 'it-IT',
  pt: 'pt-PT',
};

export function weeklyDigestTexts(language: WeeklyDigestLanguage): WeeklyDigestTexts {
  return WEEKLY_DIGEST_TEXTS[language] ?? fr;
}

export function digestDateLocale(language: WeeklyDigestLanguage): string {
  return DATE_LOCALES[language] ?? 'fr-FR';
}

/** Replaces {{name}} with its value. */
export function fillDigestText(template: string, values: Record<string, string | number> = {}) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
    values[name] === undefined ? match : String(values[name]),
  );
}

export function digestNumber(value: number, language: WeeklyDigestLanguage): string {
  return new Intl.NumberFormat(digestDateLocale(language), { maximumFractionDigits: 1 })
    .format(value)
    .replace(/\u202f/g, '\u00a0');
}

/** The singular or plural form that fits `count`, filled with the count and `values`. */
export function digestPlural(
  entry: string | Plural,
  count: number,
  language: WeeklyDigestLanguage,
  values: Record<string, string | number> = {},
): string {
  const template =
    typeof entry === 'string'
      ? entry
      : new Intl.PluralRules(digestDateLocale(language)).select(count) === 'one'
        ? entry.one
        : entry.other;
  return fillDigestText(template, { count: digestNumber(count, language), ...values });
}

/** "40 min", "1 h 05". */
export function digestDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total}\u00a0min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours}\u00a0h\u00a0${String(rest).padStart(2, '0')}` : `${hours}\u00a0h`;
}

/** "07:40" for a number of minutes after midnight (values past 1440 wrap to the next day). */
export function digestClock(minute: number): string {
  const value = ((Math.round(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

/** "16 novembre", from a local date key. */
export function digestDate(dateKey: string, language: WeeklyDigestLanguage, withYear = false) {
  return new Intl.DateTimeFormat(digestDateLocale(language), {
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(`${dateKey}T12:00:00Z`));
}

/** "Lun", "Mon", from a local date key. */
export function digestWeekdayLabel(dateKey: string, language: WeeklyDigestLanguage): string {
  const label = new Intl.DateTimeFormat(digestDateLocale(language), {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${dateKey}T12:00:00Z`));
  // Three letters in every language ("Lun", "Mon", "Seg"): seven of them fit a small chart.
  const short = label.replace(/\.$/, '').slice(0, 3);
  return short.charAt(0).toUpperCase() + short.slice(1);
}

/** "Du 16 au 22 novembre" for the week starting on `weekStart`. */
export function digestPeriod(
  weekStart: string,
  weekEnd: string,
  language: WeeklyDigestLanguage,
  withYear = false,
): string {
  const sameMonth = weekStart.slice(0, 7) === weekEnd.slice(0, 7);
  const from = sameMonth
    ? String(Number(weekStart.slice(8, 10)))
    : digestDate(weekStart, language, false);
  return fillDigestText(weeklyDigestTexts(language).period, {
    from,
    to: digestDate(weekEnd, language, withYear),
  });
}

/** The sentence of a statement, in `language`. */
export function digestStatementText(
  item: WeeklyDigestStatement,
  language: WeeklyDigestLanguage,
): string {
  const entry = weeklyDigestTexts(language).statements[item.key];
  const values: Record<string, string | number> = {};
  if (item.values.minutes !== undefined) values.duration = digestDuration(item.values.minutes);
  if (item.values.clock !== undefined) values.time = digestClock(item.values.clock);
  if (item.values.usual !== undefined) values.usual = digestNumber(item.values.usual, language);
  if (item.values.percent !== undefined)
    values.percent = digestNumber(item.values.percent, language);
  return digestPlural(entry, item.values.count ?? 1, language, values);
}

export interface WeeklyDigestTrend {
  tone: 'change' | 'stable' | 'none';
  label: string;
}

/** The short label of a theme compared with the usual ("40 min plus tard", "Comme d’habitude"). */
export function digestThemeTrend(
  digest: WeeklyDigest,
  theme: 'nights' | 'meals' | 'outings' | 'visits',
  language: WeeklyDigestLanguage,
): WeeklyDigestTrend {
  const text = weeklyDigestTexts(language).trend;
  const change = (key: WeeklyDigestStatementKey) =>
    digest.changes.find((item) => item.key === key && item.tone === 'change');
  const usual =
    theme === 'nights'
      ? digest.nights.usual
      : theme === 'meals'
        ? digest.meals.usual
        : theme === 'outings'
          ? digest.outings.usual
          : digest.visitSummary.calls.usual;
  const later = change('wakeLater') ?? change('bedtimeLater');
  const earlier = change('wakeEarlier') ?? change('bedtimeEarlier');
  if (theme === 'nights' && (later || earlier))
    return {
      tone: 'change',
      label: fillDigestText(later ? text.later : text.earlier, {
        duration: digestDuration((later ?? earlier)!.values.minutes ?? 0),
      }),
    };
  if (theme === 'nights' && (change('inBedShorter') || change('inBedLonger')))
    return {
      tone: 'change',
      label: fillDigestText(change('inBedShorter') ? text.shorter : text.longer, {
        duration: digestDuration(
          (change('inBedShorter') ?? change('inBedLonger'))!.values.minutes ?? 0,
        ),
      }),
    };
  if (theme === 'outings' && (change('fewerOutings') || change('moreOutings')))
    return { tone: 'change', label: change('fewerOutings') ? text.less : text.more };
  if (theme === 'visits' && (change('fewerCalls') || change('moreCalls')))
    return { tone: 'change', label: change('fewerCalls') ? text.less : text.more };
  if (digest.changes.some((item) => item.theme === theme && item.tone === 'change'))
    return { tone: 'change', label: text.watch };
  if (usual === null || usual === undefined) return { tone: 'none', label: text.noHistory };
  return { tone: 'stable', label: text.similar };
}
