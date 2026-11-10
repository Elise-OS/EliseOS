var lang = STORE_LANG === 'en' ? 'en' : 'fr';
var texts = {
  settings: { fr: '(.*, )?Réglages', en: '(.*, )?Settings' },
  zigbee: { fr: '.*Clé Zigbee.*', en: '.*Zigbee key.*' },
  healthy: { fr: '.*Votre clé Zigbee fonctionne.*', en: '.*Your Zigbee key is working.*' },
  search: { fr: '.*Chercher une clé.*', en: '.*Look for a key.*' },
  network: { fr: '.*Sur le réseau de la maison.*', en: '.*On the home network.*' },
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
    fr: '.*Ne débranchez rien pendant l’installation.*',
    en: '.*Do not unplug anything during the installation.*',
  },
  searching: { fr: '.*Recherche des clés.*', en: '.*Looking for keys.*' },
  empty: { fr: '.*Aucune autre clé trouvée.*', en: '.*No other key found.*' },
  advanced: { fr: '.*Mode avancé.*', en: '.*Advanced mode.*' },
  address: { fr: '.*Adresse de la clé.*', en: '.*Key address.*' },
  testAddress: { fr: '.*Tester l’adresse.*', en: '.*Test the address.*' },
  addressOk: { fr: '.*La clé réseau répond.*', en: '.*The network key answers.*' },
  done: { fr: 'Terminé', en: 'Done' },
  success: { fr: '.*La clé est installée.*', en: '.*The key is installed.*' },
};
output.zigbee = {};
for (var key in texts) output.zigbee[key] = texts[key][lang];
