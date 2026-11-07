// Tab labels may start with the icon glyph (", Home"), hence the optional prefix.
// Labels and file names used by store-screenshots.yaml, per language and device family.
var lang = STORE_LANG === 'en' || STORE_LANG === 'es' || STORE_LANG === 'it' ? STORE_LANG : 'fr';
var iphone = DEVICE !== 'ipad';
function t(fr, en, es, it) {
  return lang === 'en' ? en : lang === 'es' ? es : lang === 'it' ? it : fr;
}

output.labels = {
  demo: t(
    'Découvrir la démonstration',
    'Explore the demo',
    'Descubrir la demostración',
    'Scopri la demo',
  ),
  home: '(.*, )?' + t('Accueil', 'Home', 'Inicio', 'Home'),
  alerts: t('Alertes.*', 'Alerts.*', 'Alertas.*', 'Avvisi.*'),
  house: '(.*, )?' + t('Logement', 'My home', 'Vivienda', 'Casa'),
  room: t('.*Séjour.*', '.*Living room.*', '.*Salón.*', '.*Soggiorno.*'),
  journal: '(.*, )?' + t('Liaison', 'Notebook', 'Cuaderno', 'Collegamento'),
  screen: '(.*, )?' + t('Affichage TV', 'TV display', 'Pantalla de la TV', 'Schermo TV'),
  // A text only shown once each page is open, to retry a tap the app missed.
  alertsPage: t('ALERTES DU DOMICILE', 'HOME ALERTS', 'ALERTAS DEL DOMICILIO', 'AVVISI DELLA CASA'),
  housePage: t('FOYER', 'HOUSEHOLD', 'HOGAR', 'ABITAZIONE'),
  roomPage: t('Retour au logement', 'Back to home', 'Volver a la vivienda', 'Torni alla casa'),
  journalPage: t(
    'PARTAGE ENTRE AIDANTS',
    'SHARED BETWEEN CAREGIVERS',
    'COMPARTIDO ENTRE CUIDADORES',
    'CONDIVISO TRA CAREGIVER',
  ),
  screenPage: t('ÉCRAN DU FOYER', 'HOUSEHOLD SCREEN', 'PANTALLA DEL HOGAR', 'SCHERMO DI CASA'),
  welcomeFile: t('bienvenue', 'welcome', 'bienvenida', 'benvenuto'),
  dashboardFile: t('tableau-de-bord', 'dashboard', 'panel', 'pannello'),
  alertsFile: t('alertes', 'alerts', 'alertas', 'avvisi'),
  houseFile: t('logement', 'home', 'vivienda', 'casa'),
  roomFile: t('piece', 'room', 'estancia', 'stanza'),
  journalFile: t('liaison', 'notebook', 'cuaderno', 'collegamento'),
  screenFile: t('affichage-tv', 'tv-display', 'pantalla-tv', 'schermo-tv'),
  n: iphone
    ? { dashboard: '02', alerts: '03', house: '04', journal: '06', screen: '07' }
    : { dashboard: '01', alerts: '02', house: '03', journal: '04', screen: '05' },
};
