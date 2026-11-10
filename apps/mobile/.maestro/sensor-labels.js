// Texts of the add-a-sensor flow per language, taken from src/i18n/locales (do not edit by hand:
// regenerate with the snippet in docs/traductions.md or copy from the catalogs).
var lang = STORE_LANG === 'en' || STORE_LANG === 'es' || STORE_LANG === 'it' ? STORE_LANG : 'fr';
var texts = {
  installIn: { fr: 'Installer dans', en: 'Install in', es: 'Instalar en', it: 'Installa in' },
  addSensor: {
    fr: 'Ajouter un capteur',
    en: 'Add a sensor',
    es: 'Añadir un sensor',
    it: 'Aggiungi un sensore',
  },
  roomTitle: {
    fr: 'Où souhaitez-vous l’installer ?',
    en: 'Where will you install it?',
    es: '¿Dónde desea instalarlo?',
    it: 'Dove desidera installarlo?',
  },
  categoryTitle: {
    fr: 'Que souhaitez-vous surveiller ?',
    en: 'What would you like to monitor?',
    es: '¿Qué desea vigilar?',
    it: 'Che cosa desidera tenere d’occhio?',
  },
  catalogTitle: {
    fr: 'Choisissez votre appareil',
    en: 'Choose your device',
    es: 'Elija su aparato',
    it: 'Scelga il dispositivo',
  },
  category: {
    fr: 'Ouverture',
    en: 'Contact',
    es: 'Apertura',
    it: 'Apertura',
  },
  product: {
    fr: 'Door & Window Sensor',
    en: 'Door & Window Sensor',
    es: 'Door & Window Sensor',
    it: 'Door & Window Sensor',
  },
  install: {
    fr: 'Installer ce capteur',
    en: 'Install this sensor',
    es: 'Instalar este sensor',
    it: 'Installa questo sensore',
  },
  prepareTitle: {
    fr: 'Préparez votre capteur',
    en: 'Prepare your sensor',
    es: 'Prepare su sensor',
    it: 'Prepari il sensore',
  },
  find: {
    fr: 'Rechercher mon capteur',
    en: 'Find my sensor',
    es: 'Buscar mi sensor',
    it: 'Cerca il mio sensore',
  },
  waiting: {
    fr: 'En attente de votre capteur',
    en: 'Waiting for your sensor',
    es: 'Esperando a su sensor',
    it: 'In attesa del Suo sensore',
  },
  detected: {
    fr: 'Capteur détecté',
    en: 'Sensor detected',
    es: 'Sensor detectado',
    it: 'Sensore rilevato',
  },
  ready: {
    fr: 'Votre capteur est prêt',
    en: 'Your sensor is ready',
    es: 'Su sensor está listo',
    it: 'Il Suo sensore è pronto',
  },
  opening: {
    fr: 'Porte',
    en: 'Door',
    es: 'Puerta',
    it: 'Porta',
  },
  installedTitle: {
    fr: 'Capteur installé',
    en: 'Sensor installed',
    es: 'Sensor instalado',
    it: 'Sensore installato',
  },
  finish: {
    fr: 'Terminé',
    en: 'Done',
    es: 'Terminado',
    it: 'Fine',
  },
};
output.sensor = {};
for (var key in texts) output.sensor[key] = texts[key][lang];
function esc(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
for (var name in output.sensor) output.sensor[name] = esc(output.sensor[name]);
