// Tab labels may start with the icon glyph ("\uf382, Home"), hence the optional prefix.
// Labels and file names used by store-screenshots.yaml, per language and device family.
var fr = STORE_LANG !== 'en';
var iphone = DEVICE !== 'ipad';

output.labels = {
  demo: fr ? 'Découvrir la démonstration' : 'Explore the demo',
  home: '(.*, )?' + (fr ? 'Accueil' : 'Home'),
  alerts: fr ? 'Alertes.*' : 'Alerts.*',
  house: '(.*, )?' + (fr ? 'Logement' : 'My home'),
  room: fr ? '.*Séjour.*' : '.*Living room.*',
  journal: '(.*, )?' + (fr ? 'Liaison' : 'Notebook'),
  screen: '(.*, )?' + (fr ? 'Affichage TV' : 'TV display'),
  // A text only shown once each page is open, to retry a tap the app missed.
  alertsPage: fr ? 'ALERTES DU DOMICILE' : 'HOME ALERTS',
  housePage: fr ? 'FOYER' : 'HOUSEHOLD',
  roomPage: fr ? 'Retour au logement' : 'Back to home',
  journalPage: fr ? 'PARTAGE ENTRE AIDANTS' : 'SHARED BETWEEN CAREGIVERS',
  screenPage: fr ? 'ÉCRAN DU FOYER' : 'HOUSEHOLD SCREEN',
  welcomeFile: fr ? 'bienvenue' : 'welcome',
  dashboardFile: fr ? 'tableau-de-bord' : 'dashboard',
  alertsFile: fr ? 'alertes' : 'alerts',
  houseFile: fr ? 'logement' : 'home',
  roomFile: fr ? 'piece' : 'room',
  journalFile: fr ? 'liaison' : 'notebook',
  screenFile: fr ? 'affichage-tv' : 'tv-display',
  n: iphone
    ? { dashboard: '02', alerts: '03', house: '04', journal: '06', screen: '07' }
    : { dashboard: '01', alerts: '02', house: '03', journal: '04', screen: '05' },
};
