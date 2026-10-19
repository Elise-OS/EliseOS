import {
  isBedOccupancySensorModel,
  type RoomSensorCategory,
  type SensorProduct,
} from '@michel/contracts';

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
      'Pour suivre un lit, glissez le tapis de pression raccordé sous le matelas et gardez le boîtier à la lumière ou utilisez sa pile de secours.',
    ],
    placementEn: [
      'Install the enclosure near the wired contact to be monitored.',
      'Keep it accessible and protect the wires from being pulled out.',
      'For bed monitoring, place the connected pressure mat under the mattress and keep the enclosure in light or use its backup battery.',
    ],
    outdoor: false,
    compatibility: 'DOCUMENTED',
    verifiedAt: '2026-09-11',
    eliseValidated: false,
  },
  {
    id: 'tuya-bed-pressure-strip',
    brand: 'Tuya',
    model: 'TS0601_bed_presence_sensor',
    name: 'Bande de présence au lit',
    nameEn: 'Bed occupancy pressure strip',
    kind: 'ROOM_SENSOR',
    testQuantity: 1,
    categories: ['bed'],
    protocol: 'zigbee',
    image: image('TS0601_bed_presence_sensor'),
    sourceUrl:
      'https://www.manomano.fr/p/capteur-de-pression-multifonctionnel-tuya-zigbee-2mqtt-capteur-de-pression-a-couche-mince-flexible-bande-de-detection-liaison-intelligente-232924570',
    manualUrl: zigbee('TS0601_bed_presence_sensor'),
    integrationUrl: zigbee('TS0601_bed_presence_sensor'),
    power: 'Piles remplaçables · type et autonomie à confirmer pour cette référence vendeur',
    powerEn: 'Replaceable batteries · type and runtime to confirm for this seller reference',
    features: [
      'Bande souple de détection de pression à placer sous le matelas',
      'État binaire d’occupation du lit',
      'Batterie, luminosité et réglages de sensibilité et de temporisation exposés par Zigbee2MQTT',
    ],
    featuresEn: [
      'Flexible pressure strip to place under the mattress',
      'Binary bed occupancy state',
      'Battery, illuminance, sensitivity and timing settings exposed by Zigbee2MQTT',
    ],
    preparation: [
      'Lancez l’association Zigbee depuis Élise OS, puis activez le mode association du capteur selon sa notice. Aucun compte Smart Life/Tuya ni concentrateur Tuya n’est requis pour le modèle reconnu par Zigbee2MQTT.',
      'À la détection, vérifiez que le modèle est « TS0601_bed_presence_sensor » (Tuya) et qu’une fonction d’occupation apparaît. ManoMano ne précise pas le code Zigbee de cette référence ; si un autre modèle apparaît, ne l’assignez pas au lit avant vérification.',
    ],
    preparationEn: [
      'Start Zigbee pairing from Élise OS, then enable pairing mode on the sensor as described in its manual. The Zigbee2MQTT-recognized model needs no Smart Life/Tuya account or Tuya hub.',
      'When detected, verify the model is “TS0601_bed_presence_sensor” (Tuya) and an occupancy function appears. ManoMano does not state the Zigbee model code for this listing; if another model appears, do not assign it to a bed until checked.',
    ],
    placement: [
      'Glissez la bande sous le matelas, à l’emplacement prévu par la notice et adapté à la détection d’une personne allongée.',
      'Avant de vous fier aux horaires de coucher et de lever, vérifiez plusieurs fois dans Élise que le capteur passe à « Occupé » quand la personne s’allonge et à « Libre » quand elle se lève.',
      'Il signale une occupation détectée, pas la qualité ni les phases du sommeil.',
    ],
    placementEn: [
      'Slide the strip under the mattress, where the manual recommends and where it can detect a person lying down.',
      'Before relying on bedtime and wake-up times, check several times in Élise that the sensor changes to “Occupied” when someone lies down and “Unoccupied” when they get up.',
      'It reports detected occupancy, not sleep quality or sleep stages.',
    ],
    outdoor: false,
    compatibility: 'DOCUMENTED',
    verifiedAt: '2026-10-03',
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
  {
    id: 'heiman-fall-detection',
    brand: 'Heiman',
    model: 'HS2FD-EF1-3.0',
    name: 'Détecteur de chute Zigbee',
    nameEn: 'Zigbee Fall Detection Sensor',
    kind: 'ROOM_SENSOR',
    testQuantity: 0,
    categories: ['fall_detection'],
    protocol: 'zigbee',
    image: image('HS2FD-E'),
    sourceUrl:
      'https://materiels-electriques.fr/12308-dispositif-de-detection-de-chute-zigbee-30-heiman-hs2fd-e.html',
    manualUrl:
      'https://materiels-electriques.fr/img/cms/Info%20techniques/Fiches%20Techniques/HEIMAN/Fiche-HS2FD-E.pdf',
    integrationUrl: zigbee('HS2FD-EF1-3.0'),
    power: 'Alimentation permanente · 5 V / 2 A',
    powerEn: 'Continuous power · 5 V / 2 A',
    features: [
      'États de chute transmis par Zigbee : normal, chute suspectée ou alarme de chute',
      'Montage mural ou au plafond, pour intérieur uniquement',
      'Portée annoncée : 4 × 4 m au mur ou 4 × 5 m au plafond',
      'Aucune caméra',
    ],
    featuresEn: [
      'Fall states reported over Zigbee: normal, fall warning or fall alarm',
      'Wall or ceiling mounting, for indoor use only',
      'Advertised range: 4 × 4 m on a wall or 4 × 5 m on the ceiling',
      'No camera',
    ],
    preparation: [
      'Le vendeur référence le produit HS2FD-E ; Zigbee2MQTT documente la variante HS2FD-EF1-3.0. Faites confirmer cette référence exacte avant l’achat.',
      'Branchez le capteur à une alimentation 5 V / 2 A, près de la box Élise.',
      'Dans Élise OS, choisissez « Installer ce capteur » puis Zigbee. Placez le capteur en mode association en suivant sa notice : aucun hub ni compte Heiman n’est requis.',
      'Après l’installation, vérifiez la réception d’une alerte de chute avec le mode de test indiqué par le fabricant. Le modèle n’a pas encore été testé physiquement avec Élise.',
    ],
    preparationEn: [
      'The retailer lists HS2FD-E; Zigbee2MQTT documents variant HS2FD-EF1-3.0. Ask the seller to confirm the exact reference before buying.',
      'Connect the sensor to a 5 V / 2 A power supply near the Élise hub.',
      'In Élise OS, choose “Install this sensor” and then Zigbee. Put the sensor in pairing mode using its manual; no Heiman hub or account is required.',
      'After installation, verify a fall alert using the manufacturer’s test mode. This model has not yet been physically tested with Élise.',
    ],
    placement: [
      'Installez-le uniquement à l’intérieur et respectez la hauteur et l’orientation indiquées dans la notice.',
      'Choisissez un emplacement dégagé qui couvre la zone de vie de la personne ; la fiche annonce 4 × 4 m au mur et 4 × 5 m au plafond.',
      'Élise complète la vigilance des proches : cette détection ne remplace pas une téléassistance ni une vérification humaine.',
    ],
    placementEn: [
      'Install it indoors only and follow the height and orientation in the manual.',
      'Choose an unobstructed position covering the resident’s living area; the product sheet advertises 4 × 4 m on a wall and 4 × 5 m on the ceiling.',
      'Élise supports caregiver vigilance; fall detection does not replace telecare or a human check-in.',
    ],
    outdoor: false,
    compatibility: 'DOCUMENTED',
    verifiedAt: '2026-10-01',
    eliseValidated: false,
  },
  {
    id: 'heiman-smoke-detector',
    brand: 'Heiman',
    model: 'HS1SA-E',
    name: 'Détecteur de fumée intelligent Zigbee',
    nameEn: 'Smart Zigbee smoke detector',
    kind: 'ROOM_SENSOR',
    testQuantity: 0,
    categories: ['smoke'],
    protocol: 'zigbee',
    image: image('HS1SA-E'),
    sourceUrl:
      'https://www.domadoo.fr/fr/peripheriques/6291-heiman-detecteur-de-fumee-intelligent-zigbee-30-certifie-en14604.html',
    manualUrl: 'https://www.domadoo.fr/fr/index.php?controller=attachment&id_attachment=3062',
    integrationUrl: zigbee('HS1SA-E'),
    power: 'Pile lithium CR17335 / CR123A · 3 V',
    powerEn: 'CR17335 / CR123A lithium battery · 3 V',
    features: [
      'Détection photoélectrique de fumée et sirène locale ≥ 85 dB à 3 m',
      'Zigbee2MQTT expose les états fumée, test et batterie (0–100 %) ; Élise reçoit la fumée et le niveau de batterie',
      'Certification EN 14604 indiquée par le vendeur',
    ],
    featuresEn: [
      'Photoelectric smoke detection and built-in siren ≥ 85 dB at 3 m',
      'Zigbee2MQTT exposes smoke, test and battery (0–100%) states; Élise receives smoke and battery level',
      'EN 14604 certification listed by the retailer',
    ],
    preparation: [
      'Vérifiez la référence HS1SA-E : les variantes Heiman autonomes ou Z-Wave ne sont pas compatibles avec l’installation Zigbee Élise.',
      'Installez une pile CR123A puis rapprochez le détecteur de la box Élise.',
      'Dans Élise OS, choisissez « Installer ce capteur » puis Zigbee. Avec un trombone, maintenez le bouton latéral plus de 2 secondes jusqu’au clignotement rapide de la LED.',
      'Il rejoint le réseau Zigbee d’Élise OS via Zigbee2MQTT : aucun compte, application ni concentrateur Heiman n’est requis.',
      'Gardez le détecteur éveillé en appuyant sur son bouton toutes les 2 secondes jusqu’à la fin de l’appairage.',
      'Après l’installation, testez la sirène selon la notice et vérifiez l’état du détecteur et de sa batterie dans Élise. Zigbee2MQTT signale que certains firmwares peuvent envoyer de faux états fumée répétés ; surveillez son comportement après l’appairage.',
      'La sirène locale fonctionne sur le détecteur. Les notifications Élise complètent la vigilance et n’ont pas encore été validées sur un appareil physique.',
    ],
    preparationEn: [
      'Check the HS1SA-E reference: standalone and Z-Wave Heiman variants are not compatible with Élise Zigbee setup.',
      'Install a CR123A battery, then bring the detector near the Élise hub.',
      'In Élise OS, choose “Install this sensor” and then Zigbee. Use a paper clip to hold the side button for more than 2 seconds until the LED flashes rapidly.',
      'It joins Élise OS over Zigbee via Zigbee2MQTT; no Heiman account, app or hub is required.',
      'Keep the detector awake by pressing its button every 2 seconds until pairing is complete.',
      'After installation, test the siren as described in the manual and check the detector and battery status in Élise. Zigbee2MQTT reports that some firmware versions can send repeated false smoke states; monitor it after pairing.',
      'The detector has its own local siren. Élise notifications provide additional awareness and have not yet been validated on physical hardware.',
    ],
    placement: [
      'Fixez-le à l’emplacement et dans l’orientation prescrits par la notice et les règles applicables au logement.',
      'Gardez le détecteur dégagé, accessible pour le test, et ne le peignez ni ne le recouvrez.',
    ],
    placementEn: [
      'Mount it in the location and orientation required by the manual and applicable housing rules.',
      'Keep the detector unobstructed and accessible for testing; do not paint or cover it.',
    ],
    outdoor: false,
    compatibility: 'DOCUMENTED',
    verifiedAt: '2026-10-02',
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
          : product.categories.some((id) => ['presence', 'motion', 'fall_detection'].includes(id))
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
  TS0601_bed_presence_sensor: ['PRESSURESENSINGSTRAPBEDOCCUPANCYSENSOR', 'TZE200SEQ9CM6U'],
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
  if (isBedOccupancySensorModel(device.model))
    return (
      SENSOR_PRODUCTS.find(({ model: productModel }) => isBedOccupancySensorModel(productModel))
        ?.image ?? null
    );
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
