// Tab labels may start with the icon glyph (", Home"), hence the optional prefix.
// Labels and file names used by store-screenshots.yaml, per language and device family.
var lang = STORE_LANG === 'en' || STORE_LANG === 'es' ? STORE_LANG : 'fr';
var iphone = DEVICE !== 'ipad';
function t(fr, en, es) {
  return lang === 'en' ? en : lang === 'es' ? es : fr;
}

output.labels = {
  demo: t('Découvrir la démonstration', 'Explore the demo', 'Descubrir la demostración'),
  home: '(.*, )?' + t('Accueil', 'Home', 'Inicio'),
  alerts: t('Alertes.*', 'Alerts.*', 'Alertas.*'),
  house: '(.*, )?' + t('Logement', 'My home', 'Vivienda'),
  room: t('.*Séjour.*', '.*Living room.*', '.*Salón.*'),
  journal: '(.*, )?' + t('Liaison', 'Notebook', 'Cuaderno'),
  screen: '(.*, )?' + t('Affichage TV', 'TV display', 'Pantalla de la TV'),
  // A text only shown once each page is open, to retry a tap the app missed.
  alertsPage: t('ALERTES DU DOMICILE', 'HOME ALERTS', 'ALERTAS DEL DOMICILIO'),
  housePage: t('FOYER', 'HOUSEHOLD', 'HOGAR'),
  roomPage: t('Retour au logement', 'Back to home', 'Volver a la vivienda'),
  journalPage: t(
    'PARTAGE ENTRE AIDANTS',
    'SHARED BETWEEN CAREGIVERS',
    'COMPARTIDO ENTRE CUIDADORES',
  ),
  screenPage: t('ÉCRAN DU FOYER', 'HOUSEHOLD SCREEN', 'PANTALLA DEL HOGAR'),
  welcomeFile: t('bienvenue', 'welcome', 'bienvenida'),
  dashboardFile: t('tableau-de-bord', 'dashboard', 'panel'),
  alertsFile: t('alertes', 'alerts', 'alertas'),
  houseFile: t('logement', 'home', 'vivienda'),
  roomFile: t('piece', 'room', 'estancia'),
  journalFile: t('liaison', 'notebook', 'cuaderno'),
  screenFile: t('affichage-tv', 'tv-display', 'pantalla-tv'),
  n: iphone
    ? { dashboard: '02', alerts: '03', house: '04', journal: '06', screen: '07' }
    : { dashboard: '01', alerts: '02', house: '03', journal: '04', screen: '05' },
};
