# Écran résident et appels

Élise peut afficher son interface résident sur un écran directement relié au PC Ubuntu ou au Raspberry Pi. La sortie peut être HDMI ou DisplayPort si elle est prise en charge par le matériel et Linux. Docker héberge les services ; la session graphique et les périphériques fonctionnent sur l’hôte.

## Installer sur le NAS de test

Le NAS actuel est sous Ubuntu 24.04 AMD64. Le déploiement conserve ses données et ses autres services :

```sh
bash scripts/deploy-nas.sh --screen
```

Cette option sauvegarde la base, la configuration et les sources avant transfert, installe Jitsi et déploie les apps. Tailscale doit déjà être associé au réseau privé de la famille. Jitsi utilise HTTPS 8444 et UDP 10000 sur l’adresse Tailscale ; l’interface Élise conserve HTTPS 8443. Le port public 443 d’une autre application n’est pas modifié.

Pour activer l’écran physique, depuis le dossier du projet sur la machine Ubuntu :

```sh
sudo bash scripts/install-screen.sh https://NOM-DU-SERVEUR.ts.net:8443
```

Brancher l’écran en HDMI/DisplayPort et la webcam USB. La session `elise-screen` démarre automatiquement dans Chromium. Dans la fiche résident, ouvrir **Écran et appels → Installer et associer l’écran → Associer automatiquement la TV branchée à cette machine**. Pour un navigateur de test sur un autre ordinateur, générer un code puis le saisir sur `/resident-screen`.

L’association automatique remplace l’ancien écran. L’agent utilise une identité d’écran limitée ; aucun compte famille n’est connecté sur la TV. Les droits caméra/microphone automatiques sont restreints aux origines locales Élise/Jitsi dans les politiques Chromium.

## Appels et programmes

Recueillir l’accord pour la visio, l’enregistrer dans les réglages, puis définir les droits par proche. Le décrochage automatique n’est pas activé par défaut. Sans caméra ni microphone côté résident, l’appel fonctionne en réception seule : la TV affiche et diffuse le proche, sans tenter d’activer un périphérique absent. Vérifier caméra et microphone pendant l’installation pour activer ensuite la communication dans les deux sens.

Un appel automatique est annoncé cinq secondes avant ouverture. Un appel manuel attend trente secondes. Le bouton à l’écran ou un bouton USB émettant `Espace` ou `F13` accepte/refuse/raccroche selon le contexte. Aucun enregistrement de visio n’est effectué.

Les proches peuvent enregistrer jusqu’à 20 messages de 1 000 caractères dans « Message sur la TV ». Les textes se succèdent en boucle dans le grand bandeau supérieur ; la durée de chaque message se règle entre 5 et 600 secondes. Un seul message reste affiché en permanence. Les textes longs défilent automatiquement pour rester lisibles. Les rendez-vous permettent de choisir un pictogramme (soins, coiffeur, famille, repas, activité, promenade ou transport) et de modifier celui d’un rendez-vous existant.

Les proches peuvent envoyer des messages, déposer des photos/audio/vidéos (100 Mo par fichier), ajouter des liens YouTube et flux HTTPS lisibles par le navigateur, régler le volume et construire le planning. Le calendrier des visites existant alimente les repères de l’écran.

Le stockage local du navigateur conserve les médias déposés et le dernier état. Le programme vidéo est maintenu pendant l’appel et mis en pause. Les flux directs repartent au direct après une reconnexion. Les flux DRM et les services nécessitant une authentification propre ne sont pas pris en charge.

## Retour automatique sur la TV

La session et l’agent choisissent automatiquement une sortie connectée (HDMI avant DisplayPort), la placent en écran principal et privilégient le 1080p. L’agent détecte les débranchements/rebranchements, relance l’affichage après changement de connexion et rétablit l’image toutes les trente secondes lorsque l’écran doit être éveillé. Le volume demandé est appliqué aux haut-parleurs de la TV, y compris pendant les appels ; le microphone USB est privilégié.

L’agent utilise en priorité le CEC natif Linux (`cec-ctl`, installé automatiquement avec `v4l-utils`) : HDMI des Raspberry Pi 4/5 ou DisplayPort avec tunnel CEC compatible. Il choisit l’interface correspondant à la sortie vidéo, s’enregistre comme lecteur « EliseOS », demande l’allumage puis annonce son entrée comme source active. Il essaie aussi Text View On si Image View On échoue. Le repli USB utilise `cec-client`. Ce fonctionnement est partagé par l’installation Docker complète et le premier démarrage de l’image Raspberry Ubuntu 24.04 ARM64 ; un simple `docker compose up` ne peut pas installer les composants de contrôle matériel sur l’hôte.

L’allumage et la reprise d’entrée sont réaffirmés toutes les trente secondes, avec nouvelle tentative après dix secondes en cas d’échec. L’agent garde le dernier état demandé pendant une panne de réseau/API et continue les commandes CEC même si la session graphique ne répond pas. Une veille demandée dans Élise est respectée. Le diagnostic `/status` du socket local distingue interface détectée, commande acquittée par la TV, source active annoncée et état d’alimentation reçu. Un code de sortie logiciel nul sans acquittement CEC n’est pas considéré comme un succès.

La TV doit rester alimentée en veille, son CEC et l’allumage par appareil externe doivent être activés, et la liaison doit transmettre le CEC. Certaines liaisons DisplayPort exposent une interface et une adresse sans transmettre réellement les commandes. Une interface détectée n’est donc pas une validation de la TV. En l’absence de liaison fonctionnelle, le logiciel ne peut pas garantir l’allumage physique ni le changement d’entrée. Référence : [contrôle CEC natif et tunnels DisplayPort du noyau Linux](https://github.com/torvalds/linux/blob/master/Documentation/admin-guide/media/cec.rst).

## Secours 4G, installation explicite

```sh
sudo bash scripts/install-screen-network.sh
```

Cette installation réserve NetworkManager aux modems et laisse les interfaces Ethernet/Wi-Fi sous leur gestion existante. Dans les réglages de l’écran, saisir le nom de l’interface principale, l’APN et le PIN éventuel. Le PIN reste dans la configuration NetworkManager, jamais dans les journaux applicatifs. L’agent bascule après trois échecs et revient après cinq contrôles positifs. Les appels peuvent être interrompus pendant le changement de réseau.

## Raspberry Pi et nouvelles installations

La même pile s’utilise en ARM64. Les nouvelles installations activent `ELISE_SCREEN_ENABLED=true` par défaut. L’installateur Ubuntu et l’image Raspberry installent Docker puis terminent automatiquement Jitsi, Chromium plein écran et l’affichage HDMI/DisplayPort dès que Tailscale est associé. Aucune seconde commande n’est nécessaire. Le matériel HDMI/DP, le microphone à distance, le modem et les performances restent à valider sur le modèle retenu.

## Diagnostics et restauration

```sh
bash scripts/nas-status.sh
systemctl status lightdm elise-screen-agent
journalctl -u elise-screen-agent -n 50
```

Les sauvegardes NAS sont dans `/home/drsam/michel-backups/screen-*`. Elles contiennent `database.dump`, `environment` et `source.tar.gz`. Ne pas lancer les scripts de remise à zéro pour mettre à jour ce module. Pour revenir en arrière, restaurer d’abord les sources/configuration de la sauvegarde puis reconstruire l’ancienne version ; la migration écran est additive et peut rester en base. Une restauration de base écrase les changements postérieurs : elle doit être une opération de récupération délibérée.

## Limites de validation

L’interface mobile intègre actuellement les commandes et Jitsi dans une WebView authentifiée. Le SDK natif Jitsi publié n’est pas compatible avec la version React Native de l’app : aucune compatibilité native n’est revendiquée sans migration et essais Android/iOS. Un test logiciel ou une caméra simulée ne valide pas les périphériques réels, le CEC ni le secours 4G.

## ARTE et playlists YouTube

Dans « Affichage TV », « Regarder ARTE » lance le direct français en plein écran. Le lecteur HLS utilise les qualités proposées par le diffuseur, jusqu’à 720p, sans transcoder sur le Pi. La connexion Internet et les restrictions territoriales ou de programmes restent applicables.

Dans « Playlists YouTube », saisir un nom et coller un lien vidéo par ligne (1 à 50 vidéos), puis enregistrer. Plusieurs playlists peuvent être conservées. « Lancer » démarre depuis la première vidéo ; les suivantes s’enchaînent dans l’ordre. Les liens watch, youtu.be, shorts et live sont acceptés ; un lien vers une playlist YouTube seule n’est pas importé. Le lecteur officiel YouTube gère la lecture et peut refuser certains contenus (intégration désactivée, connexion requise, restrictions).

La télécommande commune contrôle Pause, Reprendre, Suivant et Accueil ainsi que le volume. Suivant reste dans la playlist YouTube, même si des photos sont enregistrées. Un appel ou la mise au repos suspend le lecteur ; la fin de l’appel reprend la lecture si elle n’était pas mise en pause. Accueil arrête le lecteur et revient aux informations/photos.

Validation matérielle à réaliser sur le Pi 4 : accélération vidéo de Chromium, son HDMI, lecture automatique avec son, ARTE depuis le réseau du résident, et reprise après appel. Les tests logiciels couvrent la validation des liens, l’ordre des vidéos, les commandes et la libération du lecteur.
