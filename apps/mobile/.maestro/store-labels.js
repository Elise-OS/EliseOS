// Tab labels may start with the icon glyph (", Home"), hence the optional prefix.
// Labels and file names used by store-screenshots.yaml, per language and device family.
var lang = ['en', 'es', 'it', 'pt'].indexOf(STORE_LANG) >= 0 ? STORE_LANG : 'fr';
var iphone = DEVICE !== 'ipad';
function t(fr, en, es, it, pt) {
  return { en: en, es: es, it: it, pt: pt }[lang] || fr;
}

output.labels = {
  demo: t(
    'Découvrir la démonstration',
    'Explore the demo',
    'Descubrir la demostración',
    'Scopri la demo',
    'Explorar a demonstração',
  ),
  home: '(.*, )?' + t('Accueil', 'Home', 'Inicio', 'Home', 'Início'),
  alerts: t('Alertes.*', 'Alerts.*', 'Alertas.*', 'Avvisi.*', 'Alertas.*'),
  house: '(.*, )?' + t('Logement', 'My home', 'Vivienda', 'Casa', 'Casa'),
  room: t('.*Séjour.*', '.*Living room.*', '.*Salón.*', '.*Soggiorno.*', '.*Sala.*'),
  journal: '(.*, )?' + t('Liaison', 'Notebook', 'Cuaderno', 'Collegamento', 'Caderno'),
  screen:
    '(.*, )?' + t('Affichage TV', 'TV display', 'Pantalla de la TV', 'Schermo TV', 'Ecrã da TV'),
  // A text only shown once each page is open, to retry a tap the app missed.
  alertsPage: t(
    'ALERTES DU DOMICILE',
    'HOME ALERTS',
    'ALERTAS DEL DOMICILIO',
    'AVVISI DELLA CASA',
    'ALERTAS DA CASA',
  ),
  housePage: t('FOYER', 'HOUSEHOLD', 'HOGAR', 'ABITAZIONE', 'CASA'),
  roomPage: t(
    'Retour au logement',
    'Back to home',
    'Volver a la vivienda',
    'Torni alla casa',
    'Voltar à casa',
  ),
  journalPage: t(
    'PARTAGE ENTRE AIDANTS',
    'SHARED BETWEEN CAREGIVERS',
    'COMPARTIDO ENTRE CUIDADORES',
    'CONDIVISO TRA CAREGIVER',
    'PARTILHADO ENTRE CUIDADORES',
  ),
  screenPage: t(
    'ÉCRAN DU FOYER',
    'HOUSEHOLD SCREEN',
    'PANTALLA DEL HOGAR',
    'SCHERMO DI CASA',
    'ECRÃ DA CASA',
  ),
  welcomeFile: t('bienvenue', 'welcome', 'bienvenida', 'benvenuto', 'boas-vindas'),
  dashboardFile: t('tableau-de-bord', 'dashboard', 'panel', 'pannello', 'painel'),
  alertsFile: t('alertes', 'alerts', 'alertas', 'avvisi', 'alertas'),
  houseFile: t('logement', 'home', 'vivienda', 'casa', 'casa'),
  roomFile: t('piece', 'room', 'estancia', 'stanza', 'divisao'),
  journalFile: t('liaison', 'notebook', 'cuaderno', 'collegamento', 'caderno'),
  screenFile: t('affichage-tv', 'tv-display', 'pantalla-tv', 'schermo-tv', 'ecra-tv'),
  n: iphone
    ? { dashboard: '02', alerts: '03', house: '04', journal: '06', screen: '07' }
    : { dashboard: '01', alerts: '02', house: '03', journal: '04', screen: '05' },
};
