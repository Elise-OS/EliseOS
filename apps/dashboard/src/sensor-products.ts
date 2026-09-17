import type { RoomSensorCategory, SensorProduct } from '@michel/contracts';

const zigbee = (model: string) => `https://www.zigbee2mqtt.io/devices/${model}.html`;
// Product pictures ship with the dashboard so the catalogue remains usable
// when the NAS has no Internet access.
const image = (model: string) => `/sensor-products/${model}.png`;

// Exact hardware currently available for Élise tests. DOCUMENTED confirms that
// manufacturer and integration documentation exist, not a completed physical test.
const documentedProducts: SensorProduct[] = [
  {
    id: 'thirdreality-presence-r3',
    brand: 'Third Reality',
    model: '3RPL01084Z',
    name: 'Smart Presence Sensor R3',
    nameEn: 'Smart Presence Sensor R3',
    kind: 'ROOM_SENSOR',
    testQuantity: 2,
    categories: ['presence', 'illuminance', 'air_quality'],
    protocol: 'zigbee',
    image: image('3RPL01084Z'),
    sourceUrl: 'https://www.thirdreality.com/products/smart-presence-sensor-r3',
    manualUrl:
      'https://tr-common-us-prod.s3.us-west-1.amazonaws.com/product/manual/Multi-FunctionSmartPresenceSensorR3.pdf',
    integrationUrl: zigbee('3RPL01084Z'),
    power: 'USB-C · 5 V / 1 A · alimentation permanente',
    powerEn: 'USB-C · 5 V / 1 A · continuous power',
    features: [
      'Présence immobile par radar 60 GHz',
      'Luminosité',
      'COV totaux (TVOC)',
      'Veilleuse RVB',
      'Répéteur Zigbee',
    ],
    featuresEn: [
      'Still presence via 60 GHz radar',
      'Illuminance',
      'Total volatile organic compounds (TVOC)',
      'RGB night light',
      'Zigbee repeater',
    ],
    preparation: [
      'Branchez le capteur près de la box Élise.',
      'Maintenez son bouton jusqu’au clignotement bleu pour lancer l’association Zigbee.',
    ],
    preparationEn: [
      'Plug the sensor in near the Élise hub.',
      'Hold its button until it flashes blue to start Zigbee pairing.',
    ],
    placement: [
      'À l’intérieur, face à la zone de vie et avec une vue dégagée.',
      'Ajustez la portée après le test afin de ne pas couvrir une pièce voisine.',
    ],
    placementEn: [
      'Indoors, facing the living area with a clear view.',
      'Adjust its range after testing so it does not cover an adjacent room.',
    ],
    outdoor: false,
    compatibility: 'DOCUMENTED',
    verifiedAt: '2026-09-11',
    eliseValidated: false,
  },
  {
    id: 'thirdreality-door-window',
    brand: 'Third Reality',
    model: '3RDS17BZ',
    name: 'Door & Window Sensor',
    nameEn: 'Door & Window Sensor',
    kind: 'ROOM_SENSOR',
    testQuantity: 3,
    categories: ['contact'],
    protocol: 'zigbee',
    image: image('3RDS17BZ'),
    sourceUrl: 'https://www.thirdreality.com/products/door-window-sensor',
    manualUrl: 'https://tr-common-us-prod.s3.us-west-1.amazonaws.com/product/manual/DoorSensor.pdf',
    integrationUrl: zigbee('3RDS17BZ'),
    power: '2 piles AAA',
    features: [
      'Ouverture et fermeture',
      'Niveau de batterie',
      'Temporisation d’ouverture configurable',
    ],
    powerEn: '2 AAA batteries',
    featuresEn: ['Open and closed state', 'Battery level', 'Configurable open delay'],
    preparation: [
      'Installez les piles puis rapprochez le capteur de la box Élise.',
      'Maintenez le bouton de réinitialisation jusqu’au clignotement pour l’associer.',
    ],
    preparationEn: [
      'Install the batteries, then bring the sensor close to the Élise hub.',
      'Hold the reset button until it flashes to pair it.',
    ],
    placement: [
      'Fixez le boîtier sur le cadre et l’aimant sur l’ouvrant.',
      'Alignez les repères et vérifiez ouverture puis fermeture dans le guide de test.',
    ],
    placementEn: [
      'Attach the sensor to the frame and the magnet to the moving panel.',
      'Align the marks, then verify both opening and closing in the test guide.',
    ],
    outdoor: false,
    compatibility: 'DOCUMENTED',
    verifiedAt: '2026-09-11',
    eliseValidated: false,
  },
  {
    id: 'thirdreality-motion',
    brand: 'Third Reality',
    model: '3RMS16BZ',
    name: 'Motion Sensor',
    nameEn: 'Motion Sensor',
    kind: 'ROOM_SENSOR',
    testQuantity: 2,
    categories: ['motion'],
    protocol: 'zigbee',
    image: image('3RMS16BZ'),
    sourceUrl: 'https://www.thirdreality.com/products/motion-sensor',
    manualUrl:
      'https://tr-common-us-prod.s3.us-west-1.amazonaws.com/product/manual/WirelessMotionSensor.pdf',
    integrationUrl: zigbee('3RMS16BZ'),
    power: '2 piles AAA',
    features: ['Mouvement PIR jusqu’à environ 6 m', 'Niveau de batterie'],
    powerEn: '2 AAA batteries',
    featuresEn: ['PIR motion up to approximately 6 m', 'Battery level'],
    preparation: [
      'Installez les piles et placez le capteur près de la box.',
      'Maintenez le bouton de réinitialisation jusqu’au clignotement pour l’associer.',
    ],
    preparationEn: [
      'Install the batteries and place the sensor near the hub.',
      'Hold the reset button until it flashes to pair it.',
    ],
    placement: [
      'Orientez-le vers les passages, sans obstacle devant la lentille.',
      'Évitez soleil direct, chauffage, vapeur et sources de chaleur.',
    ],
    placementEn: [
      'Aim it at passage areas with nothing blocking the lens.',
      'Avoid direct sunlight, heaters, steam and heat sources.',
    ],
    outdoor: false,
    compatibility: 'DOCUMENTED',
    verifiedAt: '2026-09-11',
    eliseValidated: false,
  },
  {
    id: 'thirdreality-climate-lite',
    brand: 'Third Reality',
    model: '3RTHS0224Z',
    name: 'Temperature & Humidity Sensor Lite',
    nameEn: 'Temperature & Humidity Sensor Lite',
    kind: 'ROOM_SENSOR',
    testQuantity: 2,
    categories: ['temperature', 'humidity'],
    protocol: 'zigbee',
    image: image('3RTHS0224Z'),
    sourceUrl: 'https://www.thirdreality.com/products/temperature-and-humidity-sensor-lite',
    manualUrl:
      'https://tr-common-us-prod.s3.us-west-1.amazonaws.com/product/manual/TemperatureandHumiditySensorGen2.pdf',
    integrationUrl: zigbee('3RTHS0224Z'),
    power: '2 piles AAA · 3 V',
    features: ['Température', 'Humidité relative', 'Niveau de batterie'],
    powerEn: '2 AAA batteries · 3 V',
    featuresEn: ['Temperature', 'Relative humidity', 'Battery level'],
    preparation: [
      'Installez les piles.',
      'Maintenez le bouton jusqu’au voyant rouge, puis relâchez : le voyant bleu clignote pendant l’association.',
    ],
    preparationEn: [
      'Install the batteries.',
      'Hold the button until the red light appears, then release it: the blue light flashes during pairing.',
    ],
    placement: [
      'Choisissez une zone représentative de la pièce, bien ventilée.',
      'Éloignez-le du soleil, des radiateurs, des fenêtres et de la vapeur.',
    ],
    placementEn: [
      'Choose a well-ventilated location representative of the room.',
      'Keep it away from sunlight, radiators, windows and steam.',
    ],
    outdoor: false,
    compatibility: 'DOCUMENTED',
    verifiedAt: '2026-09-11',
    eliseValidated: false,
  },
  {
    id: 'thirdreality-water-leak',
    brand: 'Third Reality',
    model: '3RWS18BZ',
    name: 'Water Leak Sensor',
    nameEn: 'Water Leak Sensor',
    kind: 'ROOM_SENSOR',
    testQuantity: 1,
    categories: ['water_leak'],
    protocol: 'zigbee',
    image: image('3RWS18BZ'),
    sourceUrl: 'https://www.thirdreality.com/products/water-leak-sensor',
    manualUrl:
      'https://tr-common-us-prod.s3.us-west-1.amazonaws.com/product/manual/WaterLeakSensor.pdf',
    integrationUrl: zigbee('3RWS18BZ'),
    power: '2 piles AAA',
    features: ['Détection de fuite', 'Sirène intégrée', 'Niveau de batterie'],
    powerEn: '2 AAA batteries',
    featuresEn: ['Water leak detection', 'Built-in siren', 'Battery level'],
    preparation: [
      'Installez les piles puis rapprochez le capteur de la box.',
      'Pour le réinitialiser, ouvrez le boîtier et maintenez le bouton interne jusqu’au voyant rouge ; le bleu clignote en mode association.',
    ],
    preparationEn: [
      'Install the batteries, then bring the sensor close to the hub.',
      'To reset it, open the case and hold the internal button until the red light appears; blue flashes in pairing mode.',
    ],
    placement: [
      'Posez-le à plat là où l’eau apparaîtrait en premier : sous évier, lavabo ou chauffe-eau.',
      'Gardez le boîtier accessible pour le test et l’entretien.',
    ],
    placementEn: [
      'Lay it flat where water would appear first: under a sink, basin or water heater.',
      'Keep the enclosure accessible for testing and maintenance.',
    ],
    outdoor: false,
    compatibility: 'DOCUMENTED',
    verifiedAt: '2026-09-11',
    eliseValidated: false,
  },
  {
    id: 'sonoff-climate',
    brand: 'SONOFF',
    model: 'SNZB-02P',
    name: 'Capteur de température et d’humidité',
    nameEn: 'Temperature and humidity sensor',
    kind: 'ROOM_SENSOR',
    testQuantity: 1,
    categories: ['temperature', 'humidity'],
    protocol: 'zigbee',
    image: image('SNZB-02P'),
    sourceUrl:
      'https://sonoff.tech/en-eu/products/sonoff-zigbee-temperature-and-humidity-sensor-snzb-02p',
    manualUrl: 'https://support.sonoff.tech/snzb-02p-usermanual/',
    integrationUrl: zigbee('SNZB-02P'),
    power: 'Pile CR2477 · 3 V',
    powerEn: 'CR2477 battery · 3 V',
    features: ['Température', 'Humidité relative', 'Niveau de batterie'],
    featuresEn: ['Temperature', 'Relative humidity', 'Battery level'],
    preparation: [
      'Installez la pile puis rapprochez le capteur de la box Élise.',
      'Maintenez le bouton pendant 5 secondes : le voyant clignote lentement pendant l’association.',
    ],
    preparationEn: [
      'Install the battery, then bring the sensor close to the Élise hub.',
      'Hold the button for 5 seconds: the indicator flashes slowly during pairing.',
    ],
    placement: [
      'Placez-le dans une zone représentative et bien ventilée de la pièce.',
      'Éloignez-le du soleil, des radiateurs, des fenêtres et de la vapeur.',
    ],
    placementEn: [
      'Place it in a representative, well-ventilated area of the room.',
      'Keep it away from sunlight, radiators, windows and steam.',
    ],
    outdoor: false,
    compatibility: 'DOCUMENTED',
    verifiedAt: '2026-09-13',
    eliseValidated: false,
  },
  {
    id: 'thirdreality-smart-plug-e2-eu',
    brand: 'Third Reality',
    model: '3RSPE01044BZ',
    name: 'Smart Plug E2 EU with Power Monitoring',
    nameEn: 'Smart Plug E2 EU with Power Monitoring',
    kind: 'SMART_PLUG',
    testQuantity: 2,
    categories: [],
    protocol: 'zigbee',
    image: image('3RSPE01044BZ'),
    sourceUrl: 'https://www.thirdreality.com/pages/manuals-setup-help',
    manualUrl: 'https://3reality.com/wp-content/uploads/2024/09/Smart-Plug-E2_UM_20240925.79.pdf',
    integrationUrl: zigbee('3RSPE01044BZ'),
    power: 'Secteur 100–250 V · 50/60 Hz · 16 A maximum',
    powerEn: 'Mains 100–250 V · 50/60 Hz · 16 A maximum',
    features: [
      'Marche / arrêt',
      'Puissance',
      'Énergie',
      'Courant',
      'Tension',
      'Fréquence',
      'Facteur de puissance',
      'Répéteur Zigbee',
    ],
    featuresEn: [
      'On / off',
      'Power',
      'Energy',
      'Current',
      'Voltage',
      'Frequency',
      'Power factor',
      'Zigbee repeater',
    ],
    preparation: [
      'Branchez la prise directement sur une prise murale proche de la box.',
      'Maintenez son bouton jusqu’au clignotement pour lancer l’association.',
    ],
    preparationEn: [
      'Plug it directly into a wall outlet near the hub.',
      'Hold its button until it flashes to start pairing.',
    ],
    placement: [
      'Usage intérieur uniquement.',
      'Respectez 16 A maximum et ne branchez pas plusieurs multiprises en cascade.',
    ],
    placementEn: ['Indoor use only.', 'Do not exceed 16 A and do not daisy-chain power strips.'],
    outdoor: false,
    compatibility: 'DOCUMENTED',
    verifiedAt: '2026-09-11',
    eliseValidated: false,
  },
  {
    id: 'thirdreality-smart-button',
    brand: 'Third Reality',
    model: '3RSB22BZ',
    name: 'Zigbee Smart Button',
    nameEn: 'Zigbee Smart Button',
    kind: 'ROOM_SENSOR',
    testQuantity: 2,
    categories: ['button'],
    protocol: 'zigbee',
    image: image('3RSB22BZ'),
    sourceUrl: 'https://www.thirdreality.com/products/smart-button',
    manualUrl: 'https://3reality.com/wp-content/uploads/2024/03/Smart-Button.pdf',
    integrationUrl: zigbee('3RSB22BZ'),
    power: '2 piles AAA',
    features: ['Appui simple', 'Double appui', 'Appui long', 'Niveau de batterie'],
    powerEn: '2 AAA batteries',
    featuresEn: ['Single press', 'Double press', 'Long press', 'Battery level'],
    preparation: [
      'Installez les piles et rapprochez le bouton de la box.',
      'Maintenez le bouton de réinitialisation jusqu’au clignotement pour l’associer.',
    ],
    preparationEn: [
      'Install the batteries and bring the button close to the hub.',
      'Hold the reset button until it flashes to pair it.',
    ],
    placement: [
      'Placez-le à portée de main, par exemple près du lit ou du fauteuil.',
      'Utilisez le support magnétique ou adhésif et vérifiez que la personne peut facilement l’actionner.',
    ],
    placementEn: [
      'Keep it within easy reach, for example near the bed or armchair.',
      'Use the magnetic or adhesive mount and check that the person can press it easily.',
    ],
    outdoor: false,
    compatibility: 'DOCUMENTED',
    verifiedAt: '2026-09-11',
    eliseValidated: false,
  },
  {
    id: 'nodon-opening',
    brand: 'NodOn',
    model: 'SDO-4-1-00',
    name: 'Détecteur d’ouverture Zigbee',
    nameEn: 'Zigbee Door and Window Sensor',
    kind: 'ROOM_SENSOR',
    testQuantity: 1,
    categories: ['contact'],
    protocol: 'zigbee',
    image: image('SDO-4-1-00'),
    sourceUrl:
      'https://support.nodon.fr/support/solutions/articles/150000228565-d%C3%A9tecteur-d-ouverture-portes-et-fen%C3%AAtres-zigbee-sdo-4-1-00-',
    manualUrl:
      'https://support.nodon.fr/support/solutions/articles/150000228566-d%C3%A9tecteur-d-ouverture-portes-et-fen%C3%AAtres-zigbee-sdo-4-1-00-',
    integrationUrl: zigbee('SDO-4-1-00'),
    power: 'Pile CR2032',
    features: ['Ouverture et fermeture', 'Niveau de batterie', 'Mises à jour à distance'],
    powerEn: 'CR2032 battery',
    featuresEn: ['Open and closed state', 'Battery level', 'Over-the-air updates'],
    preparation: [
      'Placez le détecteur près de la box et ouvrez le réseau Zigbee Élise.',
      'Appuyez sur le bouton du détecteur conformément à la notice NodOn.',
    ],
    preparationEn: [
      'Place the detector near the hub and open the Élise Zigbee network.',
      'Press the detector button as described in the NodOn manual.',
    ],
    placement: [
      'Fixez le capteur sur le dormant et l’aimant sur l’ouvrant.',
      'Respectez l’alignement et l’écart maximal indiqués dans la notice.',
    ],
    placementEn: [
      'Attach the sensor to the frame and the magnet to the moving panel.',
      'Follow the alignment and maximum-gap guidance in the manual.',
    ],
    outdoor: false,
    compatibility: 'DOCUMENTED',
    verifiedAt: '2026-09-11',
    eliseValidated: false,
  },
  {
    id: 'nodon-climate',
    brand: 'NodOn',
    model: 'STPH-4-1-00',
    name: 'Capteur de température et d’humidité Zigbee',
    nameEn: 'Zigbee Temperature and Humidity Sensor',
    kind: 'ROOM_SENSOR',
    testQuantity: 1,
    categories: ['temperature', 'humidity'],
    protocol: 'zigbee',
    image: image('STPH-4-1-00'),
    sourceUrl: 'https://nodon.fr/en/products/zigbee-temperature-and-humidity-sensor',
    manualUrl: 'https://nodon.fr/en/products/zigbee-temperature-and-humidity-sensor',
    integrationUrl: zigbee('STPH-4-1-00'),
    power: 'Cellule photovoltaïque · pile CR2032 facultative en zone sombre',
    powerEn: 'Photovoltaic cell · optional CR2032 battery in dark areas',
    features: [
      'Température',
      'Humidité relative',
      'Alimentation par lumière ambiante',
      'Niveau de batterie de secours',
    ],
    featuresEn: ['Temperature', 'Relative humidity', 'Ambient-light power', 'Backup battery level'],
    preparation: [
      'Placez l’interrupteur sur ON et exposez la cellule photovoltaïque à la lumière.',
      'Ouvrez le réseau Zigbee Élise puis appuyez une fois sur le bouton : orange pendant l’association, vert quand elle réussit.',
    ],
    preparationEn: [
      'Set the switch to ON and expose the photovoltaic cell to light.',
      'Open the Élise Zigbee network, then press the button once: orange while pairing and green when successful.',
    ],
    placement: [
      'Placez-le dans une zone représentative de la pièce.',
      'Orientez sa cellule vers une source de lumière ambiante et évitez les sources de chaleur ou d’humidité directe.',
    ],
    placementEn: [
      'Place it in an area representative of the room.',
      'Aim its cell toward ambient light and avoid direct heat or moisture sources.',
    ],
    outdoor: false,
    compatibility: 'DOCUMENTED',
    verifiedAt: '2026-09-11',
    eliseValidated: false,
  },
  {
    id: 'nodon-dry-contact',
    brand: 'NodOn',
    model: 'SDC-4-1-00',
    name: 'Capteur contact sec Zigbee',
    nameEn: 'Zigbee Dry Contact Sensor',
    kind: 'ROOM_SENSOR',
    testQuantity: 1,
    categories: ['contact'],
    protocol: 'zigbee',
    image: image('SDC-4-1-00'),
    sourceUrl:
      'https://support.nodon.fr/support/solutions/articles/150000229975-capteur-contact-sec-zigbee-sdc-4-1-00-',
    manualUrl:
      'https://support.nodon.fr/support/solutions/articles/150000229974-capteur-contact-sec-zigbee-sdc-4-1-00-',
    integrationUrl: zigbee('SDC-4-1-00'),
    power: 'Cellule photovoltaïque · pile CR2032 facultative en zone sombre',
    features: [
      'État d’un contact sec filaire',
      'Alimentation par lumière ambiante',
      'Niveau de batterie de secours',
      'Mises à jour à distance',
    ],
    powerEn: 'Photovoltaic cell · optional CR2032 battery in dark areas',
    featuresEn: [
      'Wired dry-contact state',
      'Ambient-light power',
      'Backup battery level',
      'Over-the-air updates',
    ],
    preparation: [
      'Raccordez uniquement un contact libre de potentiel, jamais un circuit alimenté.',
      'Exposez la cellule à la lumière, ouvrez le réseau Zigbee Élise puis lancez l’association selon la notice NodOn.',
    ],
    preparationEn: [
      'Connect only a potential-free contact, never a powered circuit.',
      'Expose the cell to light, open the Élise Zigbee network and start pairing as described in the NodOn manual.',
    ],
    placement: [
      'Installez le boîtier près du contact filaire à surveiller.',
      'Gardez-le accessible et protégez les conducteurs contre l’arrachement.',
    ],
    placementEn: [
      'Install the enclosure near the wired contact to be monitored.',
      'Keep it accessible and protect the wires from being pulled out.',
    ],
    outdoor: false,
    compatibility: 'DOCUMENTED',
    verifiedAt: '2026-09-11',
    eliseValidated: false,
  },
  {
    id: 'nodon-energy-monitor',
    brand: 'NodOn',
    model: 'SEM-4-1-00',
    name: 'Compteur d’énergie Zigbee',
    nameEn: 'Zigbee Smart Energy Monitor',
    kind: 'ENERGY_MONITOR',
    testQuantity: 1,
    categories: [],
    protocol: 'zigbee',
    image: image('SEM-4-1-00'),
    sourceUrl: 'https://nodon.fr/en/products/zigbee-smart-energy-monitor',
    manualUrl: 'https://nodon.fr/en/products/zigbee-smart-energy-monitor',
    integrationUrl: zigbee('SEM-4-1-00'),
    power: 'Tableau électrique · 110–240 V AC · 50/60 Hz · 63 A maximum',
    powerEn: 'Electrical panel · 110–240 V AC · 50/60 Hz · 63 A maximum',
    features: [
      'Puissance instantanée',
      'Énergie consommée et produite',
      'Courant',
      'Tension',
      'Mesure bidirectionnelle',
    ],
    featuresEn: [
      'Instantaneous power',
      'Energy consumed and produced',
      'Current',
      'Voltage',
      'Bidirectional metering',
    ],
    preparation: [
      'Faites installer le module dans le tableau, alimentation coupée, par un électricien qualifié.',
      'Après mise sous tension, ouvrez le réseau Zigbee Élise puis lancez l’association avec le bouton du module.',
    ],
    preparationEn: [
      'Have the module installed in the electrical panel with power off by a qualified electrician.',
      'After power-up, open the Élise Zigbee network and start pairing with the module button.',
    ],
    placement: [
      'Dans un tableau électrique intérieur, sur rail DIN.',
      'Respectez le schéma de câblage, les protections et les règles électriques de la notice.',
    ],
    placementEn: [
      'In an indoor electrical panel on a DIN rail.',
      'Follow the manual wiring diagram, protective devices and electrical requirements.',
    ],
    outdoor: false,
    compatibility: 'DOCUMENTED',
    verifiedAt: '2026-09-11',
    eliseValidated: false,
  },
];

export const SENSOR_PRODUCTS: SensorProduct[] = documentedProducts.map((product) => ({
  ...product,
  recommendation: {
    mode:
      product.kind === 'ENERGY_MONITOR'
        ? 'HOME'
        : product.kind === 'SMART_PLUG'
          ? 'APPLIANCE'
          : product.categories.some((id) => ['presence', 'motion'].includes(id))
            ? 'DETECTION'
            : product.categories.some((id) => ['contact', 'water_leak', 'button'].includes(id))
              ? 'TARGET'
              : 'ROOM',
    advice: product.placement.join(' '),
    adviceEn: product.placementEn.join(' '),
    sourceUrl: product.id === 'thirdreality-motion' ? product.sourceUrl : product.manualUrl,
    ...(product.id === 'thirdreality-motion' ? { detectionDistanceM: 6 } : {}),
  },
}));

export const TEST_HARDWARE_COUNT = SENSOR_PRODUCTS.reduce(
  (total, product) => total + product.testQuantity,
  0,
);

export function productsForCategory(category: RoomSensorCategory, outdoor: boolean) {
  const hardwareCategory = category === 'shower' ? 'humidity' : category;
  return SENSOR_PRODUCTS.filter(
    (product) => product.categories.includes(hardwareCategory) && (!outdoor || product.outdoor),
  );
}

const normalizedModel = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
const detectedModelAliases: Record<string, string[]> = {
  '3RPL01084Z': ['SMARTPRESENCESENSORR3', 'MULTIFUNCTIONSMARTPRESENCESENSORR3'],
  '3RDS17BZ': ['DOORSENSOR'],
  '3RMS16BZ': ['WIRELESSMOTIONSENSOR'],
  '3RTHS0224Z': ['TEMPERATUREANDHUMIDITYSENSORLITE'],
};

export function productMatchesDetectedModel(product: SensorProduct, detectedModel?: string | null) {
  if (!detectedModel?.trim()) return null;
  const expected = normalizedModel(product.model);
  const detected = normalizedModel(detectedModel);
  return (
    detected === expected ||
    detected.includes(expected) ||
    expected.includes(detected) ||
    (detectedModelAliases[product.model] ?? []).some((alias) => detected.includes(alias))
  );
}

export function sensorDevicePhoto(device: {
  manufacturer: string | null;
  model: string | null;
  capabilities: Array<{ capability: string }>;
}): string | null {
  const manufacturer = normalizedModel(device.manufacturer ?? '');
  const model = normalizedModel(device.model ?? '');
  const documented = SENSOR_PRODUCTS.find(
    (product) =>
      normalizedModel(product.brand) === manufacturer &&
      productMatchesDetectedModel(product, device.model) === true,
  );
  if (documented) return documented.image;
  // Home Assistant gives this Sonoff its generic name; Zigbee2MQTT identifies
  // the paired temperature/humidity hardware as SNZB-02P.
  if (
    manufacturer === 'SONOFF' &&
    ['SNZB02P', 'TEMPERATUREANDHUMIDITYSENSOR'].includes(model) &&
    device.capabilities.some(({ capability }) => capability === 'temperature') &&
    device.capabilities.some(({ capability }) => capability === 'humidity')
  )
    return '/sensor-products/SNZB-02P.png';
  return null;
}
