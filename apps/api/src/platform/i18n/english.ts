// English for the texts Élise writes itself (messages, guides, alert titles). The French text
// stays the reference: what is stored keeps it, and English readers get it translated on the way
// out. Room, people and device names typed by the family are never in this list.

const EXACT: Record<string, string> = {
  // Alerts and cameras
  'Cette alerte a déjà changé de statut.': 'This alert has already changed status.',
  'La découverte caméra accepte uniquement des plages privées de 256 adresses maximum.':
    'Camera discovery only accepts private ranges of up to 256 addresses.',
  'Cette caméra doit se trouver dans une plage privée configurée pour la découverte.':
    'This camera must be in a private range configured for discovery.',
  'Le port RTSP sélectionné ne répond plus sur le réseau local.':
    'The selected RTSP port no longer responds on the local network.',
  'Pièce introuvable.': 'Room not found.',
  'Élise n’a pas trouvé de flux vidéo utilisable. Vérifiez le mot de passe local et que ONVIF ou RTSP est activé dans l’application de la caméra.':
    'Élise found no usable video stream. Check the local password and that ONVIF or RTSP is enabled in the camera app.',
  'Adresse du flux vidéo invalide.': 'Invalid video stream address.',
  'Le flux vidéo ne pointe pas vers la caméra détectée.':
    'The video stream does not point to the detected camera.',
  'Le flux vidéo n’a pas pu être vérifié avec la caméra.':
    'The video stream could not be checked with the camera.',
  'Le consentement caméra est requis.': 'Camera consent is required.',
  'Le mode intimité est actif.': 'Privacy mode is on.',
  'Le direct est désactivé.': 'Live view is turned off.',
  'L’interphone est indisponible.': 'The intercom is unavailable.',
  'Aucune capture disponible pour cette alerte.': 'No snapshot available for this alert.',
  'Enregistrement introuvable ou expiré.': 'Recording not found or expired.',
  'Entité caméra Home Assistant introuvable.': 'Home Assistant camera entity not found.',
  'Entité de présence caméra introuvable.': 'Camera presence entity not found.',
  'Entité de confidentialité introuvable.': 'Privacy entity not found.',
  'Caméra introuvable.': 'Camera not found.',
  'Accès caméra refusé.': 'Camera access denied.',
  'Métadonnées insuffisantes : confirmation nécessaire': 'Not enough metadata: confirmation needed',
  'Appareil découvert introuvable.': 'Discovered device not found.',
  'Cette proposition a expiré. Relancez la recherche.':
    'This suggestion has expired. Search again.',
  'Entité Home Assistant indisponible.': 'Home Assistant entity unavailable.',
  'Cette action n’est pas autorisée pour cet appareil.':
    'This action is not allowed for this device.',
  'Entité Home Assistant introuvable.': 'Home Assistant entity not found.',
  'Type confirmé par un administrateur': 'Type confirmed by an administrator',
  'Accès au domicile refusé.': 'Access to the home denied.',
  'Le résident': 'The resident',
  'Un capteur installé doit appartenir à une pièce.': 'An installed sensor must belong to a room.',
  'Résumé du carnet de liaison': 'Notebook summary',
  'Humeur du résident': 'Resident mood',
  'Détecteur d’ouverture Zigbee': 'Zigbee contact sensor',
  'Capteur de température et d’humidité Zigbee': 'Zigbee temperature and humidity sensor',
  'Compteur d’énergie Zigbee': 'Zigbee energy meter',
  'Détecter les ouvertures de l’entrée principale.': 'Detect openings of the main entrance.',
  'Confirmer les changements de niveau.': 'Confirm level changes.',

  // Home plan
  'Le plan a été modifié depuis un autre écran.': 'The plan was changed from another screen.',
  'Le plan doit contenir au moins une pièce avant sa confirmation.':
    'The plan needs at least one room before it can be confirmed.',
  'Chaque pièce doit avoir un nom unique.': 'Each room must have a unique name.',
  'Identifiant de pièce invalide.': 'Invalid room identifier.',
  'Un appareil ne peut avoir qu’une cible principale.': 'A device can only have one main target.',
  'Déplacez ou retirez les capteurs installés avant de supprimer leur emplacement.':
    'Move or remove the installed sensors before deleting their location.',
  'Un équipement cible une pièce inexistante.': 'A device targets a room that does not exist.',
  'Appareil inconnu dans le plan.': 'Unknown device in the plan.',
  'Capteur inconnu dans le plan.': 'Unknown sensor in the plan.',
  'Caméra inconnue dans le plan.': 'Unknown camera in the plan.',
  'Le plan a déjà été modifié.': 'The plan has already been changed.',
  'Le plan a déjà été créé depuis un autre écran.':
    'The plan was already created from another screen.',
  'Aucune présence fiable pour le moment.': 'No reliable presence yet.',
  'Présence issue du suivi historique.': 'Presence from the tracking history.',
  'Dernière présence connue.': 'Last known presence.',
  'Plusieurs présences ou des preuves contradictoires empêchent une attribution fiable.':
    'Several presences or conflicting evidence prevent a reliable assignment.',
  'Deux niveaux ont le même identifiant.': 'Two levels have the same identifier.',
  'Le logement ne peut avoir qu’une entrée principale.':
    'The home can only have one main entrance.',
  'L’entrée principale doit être une porte donnant vers l’extérieur.':
    'The main entrance must be a door leading outside.',
  'Deux pièces ont le même identifiant.': 'Two rooms have the same identifier.',
  'Deux pièces se chevauchent.': 'Two rooms overlap.',
  'Le côté choisi pour une ouverture ne correspond pas à ses pièces.':
    'The side chosen for an opening does not match its rooms.',
  'Une liaison logique est invalide.': 'A logical link is invalid.',
  'Une ouverture ne se trouve pas sur un mur.': 'An opening is not on a wall.',
  'Un escalier possède une connexion invalide.': 'A staircase has an invalid connection.',
  'Le niveau de l’équipement est invalide.': 'The device level is invalid.',
  'La cible de l’équipement est invalide.': 'The device target is invalid.',
  'Le logement ne possède pas encore de plan.': 'The home does not have a plan yet.',
  'La pièce n’existe pas dans le plan enregistré.': 'The room does not exist in the saved plan.',
  'Le plan a déjà été modifié. Réessayez l’association.':
    'The plan has already been changed. Try the assignment again.',

  // People and access
  'Accès au logement refusé.': 'Access to the home denied.',
  'Seul le propriétaire peut nommer un administrateur.':
    'Only the owner can appoint an administrator.',
  'Identifiant, email, téléphone ou priorité déjà utilisé.':
    'Username, email, phone or priority already in use.',
  'Un compte est déjà associé.': 'An account is already linked.',
  'Cette fiche est déjà active.': 'This profile is already active.',
  'Aucun compte associé.': 'No linked account.',
  'Restaurez d’abord la fiche avant de réactiver son accès.':
    'Restore the profile before reactivating its access.',
  'Accès refusé.': 'Access denied.',
  'Accès administrateur requis.': 'Administrator access required.',
  'Le propriétaire est protégé.': 'The owner is protected.',
  'Seul le propriétaire peut gérer un administrateur.':
    'Only the owner can manage an administrator.',

  // Medications and notifications
  'Prise confirmée': 'Dose confirmed',
  'Prise ignorée par un aidant': 'Dose skipped by a caregiver',
  'Prise non confirmée': 'Dose not confirmed',
  'Abonnement de notification introuvable.': 'Notification subscription not found.',
  'Élise est bien connectée': 'Élise is connected',
  'Les notifications de votre domicile fonctionnent.': 'Notifications from your home are working.',
  'Ouvrez Élise pour consulter la situation.': 'Open Élise to check the situation.',
  'Une situation a été détectée au domicile. Ouvrez Élise pour les détails.':
    'A situation was detected at home. Open Élise for details.',
  'Élise · Nouvelle humeur dans le carnet': 'Élise · New mood in the notebook',
  'Élise · Nouveau message dans le carnet': 'Élise · New message in the notebook',
  'Ouvrez Élise pour consulter le carnet de liaison.': 'Open Élise to read the notebook.',

  // TV screen
  'Flux de podcast HTTPS invalide.': 'Invalid HTTPS podcast feed.',
  'Hôte de podcast non autorisé.': 'Podcast host not allowed.',
  'Trop de redirections RSS.': 'Too many RSS redirects.',
  'Adresse du podcast invalide.': 'Invalid podcast address.',
  'Flux RSS non pris en charge.': 'RSS feed not supported.',
  'Ce flux ne contient pas de podcast.': 'This feed does not contain a podcast.',
  'Connexion YouTube refusée.': 'YouTube connection refused.',
  'Le programme TV est temporairement indisponible.': 'The TV guide is temporarily unavailable.',
  'Droit écran insuffisant.': 'Insufficient screen permission.',
  'Agent écran indisponible ou paramètres invalides.':
    'Screen agent unavailable or invalid settings.',
  'Réponse agent invalide.': 'Invalid agent response.',
  'Installez le mode écran sur cette machine.': 'Install screen mode on this machine.',
  'Agent TV temporairement indisponible ; la demande reste enregistrée.':
    'TV agent temporarily unavailable; the request has been kept.',
  'Aucune TV Home Assistant associée.': 'No Home Assistant TV paired.',
  'Cette TV Home Assistant n’est pas disponible.': 'This Home Assistant TV is not available.',
  'TV connectée': 'TV connected',
  'Code expiré ou déjà utilisé.': 'Code expired or already used.',
  'Réglages de l’écran mis à jour': 'Screen settings updated',
  'Messages ou durée invalides.': 'Invalid messages or duration.',
  'Message affiché sur la TV': 'Message shown on the TV',
  'Message retiré de la TV': 'Message removed from the TV',
  'Choisissez une date et une heure à venir.': 'Choose a future date and time.',
  'La programmation est limitée à un an.': 'Scheduling is limited to one year.',
  'Trop de contenus sont déjà programmés.': 'Too many items are already scheduled.',
  'Contenu programmé introuvable.': 'Scheduled item not found.',
  'Rendez-vous ajouté à la TV': 'Appointment added to the TV',
  'Rendez-vous introuvable.': 'Appointment not found.',
  'Pictogramme du rendez-vous modifié': 'Appointment icon changed',
  'Rendez-vous retiré de la TV': 'Appointment removed from the TV',
  'Podcast introuvable dans le catalogue.': 'Podcast not found in the catalogue.',
  'Flux de ce podcast indisponible.': 'This podcast’s feed is unavailable.',
  'Saisissez au moins deux caractères.': 'Enter at least two characters.',
  'La recherche de podcasts est momentanément indisponible.':
    'Podcast search is temporarily unavailable.',
  'Impossible de récupérer ce podcast pour le moment.': 'This podcast cannot be fetched right now.',
  'Podcast ajouté à la bibliothèque': 'Podcast added to the library',
  'Podcast introuvable dans la bibliothèque.': 'Podcast not found in the library.',
  'Podcast retiré de la bibliothèque': 'Podcast removed from the library',
  'Les épisodes de ce podcast sont momentanément indisponibles.':
    'This podcast’s episodes are temporarily unavailable.',
  'Épisode invalide.': 'Invalid episode.',
  'Écran hors ligne.': 'Screen offline.',
  'Épisode introuvable dans ce podcast.': 'Episode not found in this podcast.',
  'La bibliothèque de médias est pleine.': 'The media library is full.',
  'Podcast lancé': 'Podcast started',
  'Réponse incorrecte': 'Incorrect answer',
  'Le catalogue des radios est momentanément indisponible.':
    'The radio catalogue is temporarily unavailable.',
  'La recherche de villes est momentanément indisponible.':
    'City search is temporarily unavailable.',
  'Saisissez le secret client Google.': 'Enter the Google client secret.',
  'URI de redirection Google invalide.': 'Invalid Google redirect URI.',
  'YouTube doit être configuré par l’administrateur avant de connecter un compte.':
    'YouTube must be set up by the administrator before an account can be connected.',
  'Connexion YouTube expirée ou refusée.': 'YouTube connection expired or refused.',
  'YouTube n’est pas configuré.': 'YouTube is not set up.',
  'Google n’a pas validé la connexion YouTube.': 'Google did not approve the YouTube connection.',
  'Google n’a pas fourni de jeton de renouvellement.': 'Google did not provide a refresh token.',
  'YouTube est momentanément indisponible.': 'YouTube is temporarily unavailable.',
  'Connectez d’abord votre compte YouTube.': 'Connect your YouTube account first.',
  'Reconnectez votre compte YouTube.': 'Reconnect your YouTube account.',
  'Cette playlist ne contient aucune vidéo lisible.': 'This playlist has no playable video.',
  'Radio lancée': 'Radio started',
  'Chaîne TV lancée': 'TV channel started',
  'Playlist YouTube lancée': 'YouTube playlist started',
  'Photo affichée': 'Photo shown',
  'Diffusion mise en pause': 'Playback paused',
  'Vidéo suivante demandée': 'Next video requested',
  'Épisode suivant demandé': 'Next episode requested',
  'Contenu suivant demandé': 'Next item requested',
  'Retour à l’accueil demandé': 'Return to the home screen requested',
  'Réveil de l’écran demandé': 'Screen wake-up requested',
  'Mise au repos demandée': 'Rest mode requested',
  'Reprise du planning demandée': 'Schedule resume requested',
  'Déposez un fichier local.': 'Drop a local file.',
  'Bibliothèque pleine.': 'Library full.',
  'Commentaire de photo modifié': 'Photo caption changed',
  'Radio mise à jour': 'Radio updated',
  'Contenu mis à jour': 'Item updated',
  'Photo ajoutée à l’album': 'Photo added to the album',
  'Radio ajoutée aux favoris': 'Radio added to favourites',
  'Contenu ajouté': 'Item added',
  'Format non pris en charge.': 'Format not supported.',
  'Radio retirée des favoris': 'Radio removed from favourites',
  'Playlist retirée': 'Playlist removed',
  'Chaîne retirée': 'Channel removed',
  'Photo retirée': 'Photo removed',
  'Jitsi doit être installé.': 'Jitsi must be installed.',
  'Le résident est déjà en communication.': 'The resident is already on a call.',
  'Le résident est au repos.': 'The resident is resting.',
  'Décrochage automatique': 'Automatic answer',
  'En attente de réponse': 'Waiting for an answer',
  Résident: 'Resident',
  'Message programmé affiché sur la TV': 'Scheduled message shown on the TV',
  'Photo programmée introuvable': 'Scheduled photo not found',
  'Photo programmée affichée': 'Scheduled photo shown',
  'Remplacée par une commande plus récente.': 'Replaced by a more recent command.',
  'Lecture indisponible.': 'Playback unavailable.',

  // Sensors and alerts written by Élise
  'État du lit mis à jour.': 'Bed status updated.',
  'Fuite d’eau détectée': 'Water leak detected',
  'Un capteur signale de l’eau dans le logement.': 'A sensor reports water in the home.',
  'Fumée détectée': 'Smoke detected',
  'Un détecteur de fumée a été déclenché.': 'A smoke detector was triggered.',
  'Monoxyde de carbone détecté': 'Carbon monoxide detected',
  'Un détecteur de monoxyde de carbone a été déclenché.':
    'A carbon monoxide detector was triggered.',
  'Bouton d’assistance activé': 'Assistance button pressed',
  'Le bouton d’assistance du domicile a été activé.': 'The home assistance button was pressed.',
  'Alerte de chute': 'Fall alert',
  'Le détecteur signale une chute possible. Vérifiez rapidement la situation.':
    'The detector reports a possible fall. Check the situation quickly.',
  'Signal revenu à la normale avant une nouvelle activation':
    'Signal back to normal before a new activation',
  'Configuration refusée.': 'Configuration refused.',
  'Le réseau Zigbee a refusé la demande.': 'The Zigbee network refused the request.',
  'Zigbee2MQTT a refusé le désappairage.': 'Zigbee2MQTT refused the unpairing.',
  'Le réseau Zigbee ne répond pas.': 'The Zigbee network is not responding.',
  'Le désappairage Zigbee a dépassé le délai attendu.': 'Zigbee unpairing took too long.',
  'Home Assistant n’a pas répondu à temps.': 'Home Assistant did not answer in time.',
  'Service arrêté.': 'Service stopped.',
  'La pièce précédente est inactive ; une autre présence encore active devient la position courante.':
    'The previous room is inactive; another presence still active becomes the current position.',
  'Coordinateur Zigbee connecté.': 'Zigbee coordinator connected.',
  'La clé Zigbee ou Zigbee2MQTT ne répond pas.':
    'The Zigbee dongle or Zigbee2MQTT is not responding.',
  'Commande indisponible pour cet appareil.': 'Command unavailable for this device.',
  'La box ne détecte actuellement aucun module permettant de rechercher un capteur.':
    'The box does not currently detect any module able to search for a sensor.',
  'Pièce inconnue.': 'Unknown room.',
  'Le lit nécessite un capteur de pression ou un contact sec dans une chambre.':
    'The bed needs a pressure sensor or a dry contact in a bedroom.',
  'Une cible précise nécessite une pièce.': 'A precise target needs a room.',
  'Choisissez une pièce avant de valider le capteur.':
    'Choose a room before confirming the sensor.',
  'Aucun nouveau capteur ne peut être installé.': 'No new sensor can be installed.',
  'Ce capteur ne fournit pas la fonction choisie.':
    'This sensor does not provide the chosen function.',
  'Cette installation a déjà été terminée.': 'This installation is already finished.',
  'Reconnu automatiquement lors de l’appairage': 'Recognised automatically during pairing',
  'La clé Zigbee doit être connectée pour désappairer complètement ce capteur.':
    'The Zigbee dongle must be connected to fully unpair this sensor.',
  'Identifiant Zigbee introuvable pour ce capteur.': 'Zigbee identifier not found for this sensor.',
  'Pièce cible invalide.': 'Invalid target room.',
  'Cette ouverture n’est pas compatible.': 'This opening is not compatible.',
  'Cet escalier n’est pas compatible.': 'This staircase is not compatible.',
  'Cet objet n’est pas compatible.': 'This object is not compatible.',
  'Capteur température et humidité': 'Temperature and humidity sensor',
  'Détecteur de mouvement': 'Motion detector',
  'Capteur de présence': 'Presence sensor',
  'Détecteur d’ouverture': 'Contact sensor',
  'Détecteur de fuite d’eau': 'Water leak detector',
  'Les mises à jour exigent le réseau local ou Tailscale.':
    'Updates require the local network or Tailscale.',
  'Une porte': 'A door',
  'Le niveau de batterie est momentanément indisponible.':
    'The battery level is temporarily unavailable.',
  'Activité nocturne inhabituelle': 'Unusual night-time activity',
  'Retour automatique à la normale': 'Automatically back to normal',
  'Données capteurs suffisantes': 'Enough sensor data',
  'Aucune activité récente': 'No recent activity',
  'Données capteurs insuffisantes': 'Not enough sensor data',
  'Élise ne reçoit plus assez de données fiables pour évaluer la situation.':
    'Élise no longer receives enough reliable data to assess the situation.',
  'Aucune activité de mouvement récente': 'No recent movement activity',
  'Destination confirmée après une présence persistante de 20 secondes.':
    'Destination confirmed after 20 seconds of continuous presence.',
  'Durée de présence revenue à l’habitude': 'Presence duration back to usual',

  // Simulation scenarios
  'Matinée habituelle': 'Usual morning',
  'Mouvements, passage en cuisine et température confortable.':
    'Movements, a trip to the kitchen and a comfortable temperature.',
  'Porte ouverte puis refermée': 'Door opened then closed',
  'Simule un passage normal par la porte d’entrée.':
    'Simulates a normal trip through the front door.',
  'Porte laissée ouverte': 'Door left open',
  'Laisse la porte d’entrée ouverte depuis dix minutes.':
    'Leaves the front door open for ten minutes.',
  'Absence prolongée de mouvement': 'Long absence of movement',
  'Place la dernière activité fiable quatre heures auparavant.':
    'Puts the last reliable activity four hours ago.',
  'Température basse': 'Low temperature',
  'Place le salon à 15,5 °C depuis quinze minutes.':
    'Puts the living room at 15.5 °C for fifteen minutes.',
  'Activité nocturne répétée': 'Repeated night-time activity',
  'Ajoute plusieurs mouvements rapprochés pendant la nuit.':
    'Adds several close movements during the night.',
  'Place la batterie du capteur d’entrée à 8 %.': 'Puts the entrance sensor battery at 8%.',
  'Place la dernière communication du capteur trois heures auparavant.':
    'Puts the sensor’s last communication three hours ago.',
  'Déclenche un appel immédiat de démonstration.': 'Triggers an immediate demo call.',

  // Sensor labels and placement guides
  Caméra: 'Camera',
  Mouvement: 'Motion',
  Présence: 'Presence',
  'Présence humaine': 'Human presence',
  Ouverture: 'Opening',
  'Bouton d’assistance': 'Assistance button',
  Température: 'Temperature',
  Humidité: 'Humidity',
  Puissance: 'Power',
  Énergie: 'Energy',
  Batterie: 'Battery',
  'Fuite d’eau': 'Water leak',
  Fumée: 'Smoke',
  'Monoxyde de carbone': 'Carbon monoxide',
  'Composés organiques volatils': 'Volatile organic compounds',
  'Particules fines': 'Fine particles',
  'Qualité de l’air': 'Air quality',
  Luminosité: 'Light level',
  'Chute non visuelle': 'Non-visual fall detection',
  'Qualité radio': 'Radio quality',
  'Capteur à identifier': 'Sensor to identify',
  'Installer le contact du lit': 'Install the bed contact',
  'Le module NodOn lit un contact sec raccordé à un tapis de pression placé sous le matelas.':
    'The NodOn module reads a dry contact wired to a pressure mat placed under the mattress.',
  'Placez le tapis de pression compatible sous le matelas, à la zone d’appui habituelle.':
    'Place the compatible pressure mat under the mattress, where the person usually lies.',
  'Raccordez son contact libre de potentiel au module NodOn, sans aucune alimentation sur les bornes de contact.':
    'Wire its potential-free contact to the NodOn module, with no power on the contact terminals.',
  'Gardez le module accessible et exposé à la lumière, ou installez sa pile de secours en zone sombre.':
    'Keep the module reachable and in the light, or fit its backup battery in a dark spot.',
  'Vérifiez dans la carte Lit que les états Occupé et Libre correspondent à la réalité ; inversez le réglage si nécessaire.':
    'Check on the Bed card that the Occupied and Empty states match reality; invert the setting if needed.',
  'Plier ou coincer le tapis': 'Folding or pinching the mat',
  'Placer le module photovoltaïque sous le matelas sans pile de secours':
    'Placing the solar module under the mattress without a backup battery',
  'Appuyez sur le tapis de pression puis relâchez-le pour vérifier les deux changements d’état.':
    'Press the pressure mat, then release it to check both state changes.',
  'Le repère obtenu est une estimation de l’occupation du lit, pas une mesure du sommeil.':
    'The result estimates bed occupancy; it does not measure sleep.',
  'Couvrir les passages utiles': 'Cover the useful paths',
  'Fixez-le à la hauteur recommandée par le fabricant.':
    'Mount it at the height recommended by the manufacturer.',
  'Orientez-le vers le passage principal, pas directement vers une porte ou une fenêtre.':
    'Point it at the main path, not straight at a door or a window.',
  'Laissez la zone dégagée puis marchez devant le capteur pour le tester.':
    'Keep the area clear, then walk in front of the sensor to test it.',
  'Radiateur, soleil direct et rideau mobile': 'Radiators, direct sunlight and moving curtains',
  'Zone masquée par un meuble': 'Area hidden by furniture',
  'Passez normalement devant le capteur.': 'Walk past the sensor as usual.',
  'Aligner les deux parties': 'Line up the two parts',
  'Fixez une partie sur l’ouvrant et l’autre sur le cadre, au plus près l’une de l’autre.':
    'Fix one part on the moving side and the other on the frame, as close together as possible.',
  'Nettoyez et séchez le support.': 'Clean and dry the surface.',
  'Alignez les repères aimantés porte fermée.': 'Line up the magnetic marks with the door closed.',
  'Ouvrez puis refermez une fois.': 'Open and close once.',
  'Charnière ou surface qui vibre': 'Hinges or vibrating surfaces',
  'Écart supérieur à celui indiqué par le fabricant': 'A gap wider than the manufacturer allows',
  'Ouvrez puis refermez la porte ou la fenêtre.': 'Open and close the door or window.',
  'Au point le plus bas': 'At the lowest point',
  'Posez la sonde au sol, là où l’eau apparaîtrait en premier.':
    'Put the probe on the floor, where water would appear first.',
  'Placez-la sous l’évier, près du lave-linge ou du chauffe-eau.':
    'Place it under the sink, near the washing machine or the water heater.',
  'Gardez le boîtier et ses contacts accessibles.': 'Keep the case and its contacts reachable.',
  'Utilisez le bouton de test du fabricant si disponible.':
    'Use the manufacturer’s test button if there is one.',
  'Surface régulièrement mouillée': 'Surfaces that are often wet',
  'Utilisez le test prévu par le fabricant, sans immerger le boîtier.':
    'Use the manufacturer’s test, without submerging the case.',
  'Élise complète la vigilance du logement mais ne garantit pas la détection de toutes les fuites.':
    'Élise adds to the home’s watchfulness but does not guarantee every leak is detected.',
  'Couvrir la zone de vie': 'Cover the living area',
  'Installez le détecteur selon la hauteur et l’orientation indiquées par Heiman, avec une vue dégagée sur la zone à protéger.':
    'Install the detector at the height and angle given by Heiman, with a clear view of the area to protect.',
  'Choisissez un montage mural ou au plafond prévu par la notice.':
    'Choose the wall or ceiling mounting described in the manual.',
  'Vérifiez que les meubles et cloisons ne masquent pas la zone de détection.':
    'Check that furniture and walls do not block the detection area.',
  'Utilisez uniquement le mode de test du fabricant pour vérifier l’alerte Élise.':
    'Only use the manufacturer’s test mode to check the Élise alert.',
  'Usage extérieur': 'Outdoor use',
  'Zone masquée ou couverture partielle de la pièce': 'Hidden area or partial room coverage',
  'Utilisez le mode de test indiqué dans la notice Heiman.':
    'Use the test mode described in the Heiman manual.',
  'Une alerte demande une vérification auprès de la personne. La détection Élise ne remplace ni une téléassistance ni les services d’urgence.':
    'An alert calls for checking on the person. Élise detection replaces neither a personal alarm service nor the emergency services.',
  'Respecter la notice de sécurité': 'Follow the safety manual',
  'L’emplacement dépend du type de détecteur et des règles applicables dans le logement.':
    'The location depends on the detector type and the rules that apply in the home.',
  'Suivez en priorité la notice du fabricant.': 'Follow the manufacturer’s manual first.',
  'Utilisez la fixation prévue.': 'Use the mounting provided.',
  'Actionnez le bouton de test après la pose.': 'Press the test button after fitting it.',
  'Recouvrir ou peindre le détecteur': 'Covering or painting the detector',
  'Improviser une position contraire à la notice':
    'Improvising a position the manual advises against',
  'Appuyez sur le bouton de test du détecteur.': 'Press the detector’s test button.',
  'Élise n’est ni un dispositif de sécurité certifié ni un service d’urgence.':
    'Élise is neither a certified safety device nor an emergency service.',
  'Placez le capteur dans une zone représentative de la pièce et bien ventilée.':
    'Place the sensor in a well-ventilated spot that represents the room.',
  'Posez-le à hauteur de respiration.': 'Set it at breathing height.',
  'Éloignez-le des sources de chaleur et de vapeur.': 'Keep it away from heat and steam.',
  'Attendez une première mesure stable.': 'Wait for a first steady reading.',
  'Fenêtre ouverte, radiateur ou soleil direct': 'Open windows, radiators or direct sunlight',
  'Hotte, douche ou bouilloire à proximité immédiate':
    'A cooker hood, shower or kettle right next to it',
  'Attendez la réception d’une nouvelle mesure.': 'Wait for a new reading.',
  'Rester facile à atteindre': 'Stay easy to reach',
  'Placez le bouton là où la personne peut l’utiliser sans effort et sans risque de chute.':
    'Place the button where the person can use it without effort or risk of falling.',
  'Choisissez un emplacement visible et accessible.': 'Choose a visible, reachable spot.',
  'Appuyez une fois pour vérifier la réception.': 'Press once to check it is received.',
  'Derrière un meuble': 'Behind furniture',
  'Emplacement nécessitant de se pencher ou de monter': 'A spot that needs bending or climbing',
  'Appuyez une fois sur le bouton.': 'Press the button once.',
  'Ce bouton ne remplace pas une téléassistance disposant de sa propre liaison de secours.':
    'This button does not replace a personal alarm service with its own emergency line.',
  'Choisir une place représentative': 'Choose a representative spot',
  'Suivez la notice du fabricant et gardez le capteur accessible pour son entretien.':
    'Follow the manufacturer’s manual and keep the sensor reachable for maintenance.',
  'Affectez d’abord le capteur à une pièce.': 'Assign the sensor to a room first.',
  'Fixez-le sans masquer sa zone de mesure.': 'Mount it without blocking its measuring area.',
  'Déclenchez ou attendez une nouvelle mesure.': 'Trigger or wait for a new reading.',
  'Source de chaleur ou d’humidité non représentative':
    'An unrepresentative heat or humidity source',
  'Zone inaccessible pour changer la pile': 'A spot where the battery cannot be changed',
  'Déclenchez le capteur une fois.': 'Trigger the sensor once.',
  'Attendez une nouvelle mesure.': 'Wait for a new reading.',
};

type Pattern = [RegExp, (...parts: string[]) => string];

const PATTERNS: Pattern[] = [
  [/^Reconnu grâce au type (.+)$/, (type) => `Recognised from the type ${type}`],
  [/^Humeur de (.+)$/, (name) => `${name}’s mood`],
  [/^Présence confirmée dans (.+)\.$/, (room) => `Presence confirmed in ${room}.`],
  [
    /^Déplacement probable de (.+) vers (.+?)(, avec un passage intermédiaire non observé)?\.$/,
    (from, to, hidden) =>
      `Probably moving from ${from} to ${to}${hidden ? ', through an unobserved room' : ''}.`,
  ],
  [
    /^Dernière présence fiable dans (.+), sans confirmation récente\.$/,
    (room) => `Last reliable presence in ${room}, not recently confirmed.`,
  ],
  [/^La forme de « (.+) » est invalide\.$/, (room) => `The shape of “${room}” is invalid.`],
  [/^(.+) lancée$/, (title) => `${title} started`],
  [/^Volume réglé à (\d+) %$/, (volume) => `Volume set to ${volume}%`],
  [/^Appel de (.+)$/, (name) => `Call from ${name}`],
  [/^Activité probable de (.+)\.$/, (label) => `Likely activity of ${label}.`],
  [/^Ouverture détectée sur (.+)\.$/, (label) => `Opening detected on ${label}.`],
  [/^Présence probable près de (.+)\.$/, (label) => `Likely presence near ${label}.`],
  [/^Fuite possible près de (.+)\.$/, (label) => `Possible leak near ${label}.`],
  [/^Mesure contextualisée près de (.+)\.$/, (label) => `Reading in context near ${label}.`],
  [/^Première présence fiable dans (.+)\.$/, (room) => `First reliable presence in ${room}.`],
  [
    /^Présence détectée directement dans (.+)\.$/,
    (room) => `Presence detected directly in ${room}.`,
  ],
  [
    /^Placez le capteur dans (.+), orienté vers la zone de passage sans filmer ni enregistrer\.$/,
    (room) =>
      `Place the sensor in ${englishRoom(room)}, facing the walkway, without filming or recording.`,
  ],
  [/^(.+) ne répond plus$/, (name) => `${name} is not responding`],
  [
    /^Le capteur (.+?)(?: de (.+))? ne transmet plus de données à Élise\. Les conclusions qui en dépendent sont suspendues\.$/,
    (name, room) =>
      `The sensor ${name}${room ? ` in ${room}` : ''} no longer sends data to Élise. Conclusions that rely on it are on hold.`,
  ],
  [/^(.+) est restée ouverte$/, (door) => `${door === 'Une porte' ? 'A door' : door} stayed open`],
  [
    /^L’ouverture dure depuis plus de (\d+) minutes\. Une vérification simple peut être utile\.$/,
    (minutes) => `It has been open for more than ${minutes} minutes. A quick check may help.`,
  ],
  [/^Batterie faible pour (.+)$/, (name) => `Low battery for ${name}`],
  [
    /^La batterie indique (\d+) %\. Son remplacement peut être planifié\.$/,
    (level) => `The battery reads ${level}%. Its replacement can be planned.`,
  ],
  [/^Température basse dans (.+)$/, (room) => `Low temperature in ${englishRoom(room)}`],
  [/^Température élevée dans (.+)$/, (room) => `High temperature in ${englishRoom(room)}`],
  [
    /^La température est à (.+) °C, sous le seuil de (.+) °C depuis au moins (\d+) minutes\.$/,
    (now, limit, minutes) =>
      `The temperature is ${now} °C, below the ${limit} °C threshold for at least ${minutes} minutes.`,
  ],
  [
    /^La température est à (.+) °C, au-dessus du seuil de (.+) °C depuis au moins (\d+) minutes\.$/,
    (now, limit, minutes) =>
      `The temperature is ${now} °C, above the ${limit} °C threshold for at least ${minutes} minutes.`,
  ],
  [
    /^(\d+) mouvements ont été observés pendant la plage nocturne configurée\.$/,
    (count) => `${count} movements were observed during the configured night-time window.`,
  ],
  [/^Aucun mouvement depuis (.+)$/, (duration) => `No movement for ${englishDuration(duration)}`],
  [
    /^Dernier mouvement fiable : (.+?)(?:, dans (.+))?\. Seuil d’alerte configuré : (.+) sans mouvement\.$/,
    (date, room, limit) =>
      `Last reliable movement: ${date}${room ? `, in ${room}` : ''}. Alert threshold: ${englishDuration(limit)} without movement.`,
  ],
  [
    /^Aucun mouvement fiable reçu\. Seuil d’alerte configuré : (.+)\.$/,
    (limit) => `No reliable movement received. Alert threshold: ${englishDuration(limit)}.`,
  ],
  [/^Présence inhabituellement longue dans (.+)$/, (room) => `Unusually long presence in ${room}`],
  [
    /^La présence dans (.+) dure depuis (.+) ; la durée habituelle est d’environ (.+)\.$/,
    (room, elapsed, usual) =>
      `Presence in ${room} has lasted ${englishDuration(elapsed)}; it usually lasts about ${englishDuration(usual)}.`,
  ],
  [/^Prise de (.+) non confirmée$/, (time) => `${time} dose not confirmed`],
  [
    /^La prise de (.+) \((.+)\) prévue à (.+) n’a pas encore été confirmée\. Un oubli est possible ; une vérification peut être utile\.$/,
    (name, dosage, time) =>
      `The ${time} dose of ${name} (${dosage}) has not been confirmed yet. It may have been missed; a check may help.`,
  ],
];

const ROOMS: Record<string, string> = {
  'le logement': 'the home',
  'la pièce': 'the room',
  'la salle de bain': 'the bathroom',
};
const englishRoom = (room: string) => ROOMS[room] ?? room;

/** “2 h 15 min”, “3 h”, “45 min” or “1 jour” become English durations. */
const englishDuration = (value: string) =>
  value
    .replace(/(\d+) jours?/g, (_, days: string) => `${days} day${days === '1' ? '' : 's'}`)
    .replace(/(\d+) h\b/g, '$1 hr');

export function toEnglish(text: string): string {
  const exact = EXACT[text];
  if (exact) return exact;
  for (const [pattern, write] of PATTERNS) {
    const match = pattern.exec(text);
    if (match) return write(...match.slice(1).map((part) => part ?? ''));
  }
  return text;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
};

/** Texts Élise wrote are translated wherever they sit in an answer; everything else is kept. */
export function translateDeep<T>(value: T): T {
  if (typeof value === 'string') return toEnglish(value) as T;
  if (Array.isArray(value)) return value.map((item: unknown) => translateDeep(item)) as T;
  if (value instanceof Date || !isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, translateDeep(item)]),
  ) as T;
}
