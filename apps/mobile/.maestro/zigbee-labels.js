var lang = STORE_LANG === 'en' ? 'en' : 'fr';
var texts = {
  settings: { fr: '(.*, )?Réglages', en: '(.*, )?Settings' },
  zigbee: { fr: '.*Clé Zigbee.*', en: '.*Zigbee key.*' },
  healthy: { fr: '.*Votre clé Zigbee fonctionne.*', en: '.*Your Zigbee key is working.*' },
  detect: { fr: '.*Détecter une clé.*', en: '.*Detect a key.*' },
  identify: { fr: '.*Identifier la clé.*', en: '.*Identify the key.*' },
  useInstead: {
    fr: '.*Utiliser cette clé à la place.*',
    en: '.*Use this key instead.*',
  },
  confirm: {
    fr: '.*Installer Sonoff ZBDongle-P \\?.*',
    en: '.*Install Sonoff ZBDongle-P\\?.*',
  },
  install: { fr: '.*Installer la clé.*', en: '.*Install the key.*' },
  installing: {
    fr: '.*Installation de la clé en cours.*',
    en: '.*Installing the key.*',
  },
  success: { fr: '.*La clé est installée.*', en: '.*The key is installed.*' },
};
output.zigbee = {};
for (var key in texts) output.zigbee[key] = texts[key][lang];
