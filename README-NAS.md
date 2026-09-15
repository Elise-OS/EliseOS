# Élise OS — déploiement et remise à zéro du NAS

Ce guide concerne le NAS de test accessible à l'adresse `192.168.1.55` avec
l'utilisateur `drsam`. Le Mac sert uniquement à modifier et transférer les sources :
les dépendances, les images et les services Docker sont construits et exécutés sur le NAS.

## Adresses et chemins utilisés

- Interface Élise OS : <http://192.168.1.55:8090>
- Projet sur le Mac : `/Users/paulbreton/Desktop/Michel`
- Projet sur le NAS : `/home/drsam/michel-os`
- Cible SSH utilisée par le script : `michel-nas`

## 1. Préparer une fois la connexion depuis le Mac

### Créer une clé SSH dédiée

Ne pas relancer la commande suivante si le fichier `~/.ssh/elise_nas` existe déjà :

```bash
ssh-keygen -t ed25519 -f ~/.ssh/elise_nas -C "elise-os-nas"
```

Installer la clé publique sur le NAS. Le mot de passe SSH est demandé une dernière fois :

```bash
cat ~/.ssh/elise_nas.pub | ssh drsam@192.168.1.55 \
  'umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys'
```

Ajouter ensuite ce bloc dans `~/.ssh/config` sur le Mac :

```sshconfig
Host michel-nas
  HostName 192.168.1.55
  User drsam
  IdentityFile ~/.ssh/elise_nas
  IdentitiesOnly yes
```

Vérifier la connexion :

```bash
ssh michel-nas 'hostname && docker compose version'
```

### Configurer le déploiement du projet

Depuis le dossier du projet sur le Mac :

```bash
cd /Users/paulbreton/Desktop/Michel
cp config/nas-deploy.env.example config/nas-deploy.env
```

Le fichier local `config/nas-deploy.env` doit contenir :

```dotenv
MICHEL_NAS_TARGET=michel-nas
MICHEL_NAS_PATH=/home/drsam/michel-os
MICHEL_NAS_URL=http://192.168.1.55:8090
MICHEL_NAS_HTTP_PORT=8090
```

Le réglage facultatif `MICHEL_NAS_BUILDER` sélectionne un constructeur Docker dédié pour les déploiements. Sur ce NAS, `michel-deploy` utilise des serveurs DNS accessibles depuis les étapes de construction, afin d’éviter les délais du résolveur Tailscale. Le constructeur est sélectionné uniquement pour ce projet, sans changer celui des autres applications.

Ce fichier est ignoré par Git. Le script conserve également le `.env`, les secrets,
les sauvegardes et les volumes Docker présents sur le NAS.

## 2. Déployer Élise OS depuis le Mac

### Commandes simples recommandées

Les scripts suivants se lancent depuis le dossier du projet sur le Mac. Docker et les
dépendances applicatives restent entièrement sur le NAS.

```bash
cd /Users/paulbreton/Desktop/Michel

# Déployer les modifications du Mac vers le NAS
bash scripts/deploy-nas.sh

# Vérifier les conteneurs et la santé de l'API
bash scripts/nas-status.sh

# Vider uniquement la base Élise et recréer le premier administrateur
bash scripts/nas-reset-database.sh

# Supprimer tous les volumes et refaire une installation entièrement propre
bash scripts/nas-clean-install.sh
```

Les deux derniers scripts affichent ce qui sera supprimé et demandent de saisir une phrase
de confirmation. L'option `--yes` permet de supprimer cette confirmation dans une automatisation,
mais elle ne doit être utilisée qu'en connaissance de cause.

Si `pnpm` est déjà disponible sur le Mac, les raccourcis équivalents sont :

```bash
pnpm deploy:nas
pnpm nas:status
pnpm nas:reset-db
pnpm nas:clean-install
```

### Déploiement standard

Le déploiement standard transfère les sources, puis construit et relance les services
applicatifs directement sur le NAS :

```bash
cd /Users/paulbreton/Desktop/Michel
bash scripts/deploy-nas.sh
```

Si `pnpm` est déjà disponible sur le Mac, la commande équivalente est :

```bash
pnpm deploy:nas
```

Commandes utiles :

```bash
# Prévisualiser les fichiers transférés sans modifier le NAS
bash scripts/deploy-nas.sh --dry-run

# Reconstruire uniquement l'interface
bash scripts/deploy-nas.sh --dashboard

# Afficher l'état des services sur le NAS
ssh michel-nas 'cd /home/drsam/michel-os && docker compose ps'

# Suivre les journaux applicatifs
ssh michel-nas 'cd /home/drsam/michel-os && docker compose logs -f --tail=100 api worker dashboard'
```

Après le déploiement, vérifier :

```bash
curl --fail http://192.168.1.55:8090/api/v1/system/health
open http://192.168.1.55:8090
```

### Connecter YouTube

La carte « Médias » peut se connecter à un compte Google en OAuth et importer ses playlists
personnelles. Dans Google Cloud, activez **YouTube Data API v3**, créez un identifiant OAuth
« Application Web », puis ajoutez exactement cette URI de redirection :

```text
https://toquehub.tail0ffd40.ts.net:8443/api/v1/screen/youtube/callback
```

Les identifiants peuvent être renseignés directement dans **Réglages → Compte Google** :
collez le Client ID, le secret client et vérifiez l’URI de redirection, puis enregistrez.
Ces valeurs servent à la fois à **Affichage TV → YouTube** et au futur module **Calendrier →
Google Calendar**. La connexion au compte se fait ensuite depuis **Affichage TV → Médias →
YouTube → Connecter Google**. Les jetons de renouvellement sont chiffrés avant d’être enregistrés
et peuvent être révoqués avec **Déconnecter**.

Pour une configuration automatisée, `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` et
`YOUTUBE_REDIRECT_URI` restent aussi acceptés dans le `.env` du NAS.

## 3. Travailler uniquement sur le frontend depuis le Mac

Le script suivant lance seulement Vite et le dashboard React sur le Mac. Il ne lance ni
Docker, ni PostgreSQL, ni l'API, ni l'IA localement. Les appels `/api` sont redirigés vers
l'adresse du NAS définie par `MICHEL_NAS_URL` dans `config/nas-deploy.env`.

```bash
cd /Users/paulbreton/Desktop/Michel
bash scripts/dev-dashboard.sh
```

Au premier lancement, seules les dépendances nécessaires au frontend et à ses paquets
partagés sont installées. Le navigateur s'ouvre ensuite sur <http://127.0.0.1:5173>.
Arrêter le serveur avec `Ctrl+C`.

Options utiles :

```bash
# Choisir explicitement l'API du NAS
bash scripts/dev-dashboard.sh --api http://192.168.1.55:8090

# Utiliser un autre port local
bash scripts/dev-dashboard.sh --port 5174

# Forcer la réinstallation des dépendances frontend
bash scripts/dev-dashboard.sh --install

# Lancer sans ouvrir automatiquement le navigateur
bash scripts/dev-dashboard.sh --no-open

```

Avec `pnpm`, le raccourci équivalent est :

```bash
pnpm dev:dashboard
```

## 4. Vider uniquement la base Élise

Cette opération supprime les comptes, logements, alertes, équipements et observations
d'Élise. Elle conserve les secrets Docker, les médias, les modèles IA, Home Assistant et
sa propre base de données.

La méthode recommandée depuis le Mac est le script sécurisé :

```bash
cd /Users/paulbreton/Desktop/Michel
bash scripts/nas-reset-database.sh
```

Les commandes manuelles correspondantes sont détaillées ci-dessous pour le diagnostic.

Se connecter au NAS :

```bash
ssh michel-nas
cd /home/drsam/michel-os
```

Arrêter les services qui utilisent la base Élise, recréer la base, puis relancer
l'application. L'API réappliquera automatiquement toutes les migrations :

```bash
docker compose stop dashboard worker api
docker compose exec -T postgres psql -U michel -d postgres -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE michel WITH (FORCE);'
docker compose exec -T postgres psql -U michel -d postgres -v ON_ERROR_STOP=1 \
  -c 'CREATE DATABASE michel OWNER michel;'
docker compose up -d api worker dashboard
```

Contrôler ensuite le résultat :

```bash
docker compose ps
curl --fail http://127.0.0.1:8090/api/v1/system/health
```

En ouvrant l'interface, Élise doit proposer la création d'un nouvel administrateur.

## 5. Repartir d'une installation entièrement propre

> **Attention :** cette procédure supprime définitivement la base Élise, la base Home
> Assistant, les comptes, les secrets générés, les médias, les instantanés caméra, les
> données MQTT et Zigbee ainsi que les modèles IA. Les sources et le `.env` du NAS sont
> conservés.

La méthode recommandée depuis le Mac est :

```bash
cd /Users/paulbreton/Desktop/Michel
bash scripts/nas-clean-install.sh
```

Le script vérifie le chemin distant, demande de taper `REINSTALLER ELISE`, reconstruit les
services sur le NAS et attend que l'interface et l'API répondent. Les étapes manuelles restent
documentées ci-dessous.

### Sauvegarde facultative avant suppression

Pour une sauvegarde de test non chiffrée stockée hors du dossier synchronisé :

```bash
ssh michel-nas
cd /home/drsam/michel-os
mkdir -p /home/drsam/michel-backups
MICHEL_BACKUP_ALLOW_PLAINTEXT=true ./scripts/backup.sh /home/drsam/michel-backups
```

Cette sauvegarde peut contenir des données personnelles et doit rester sur un stockage privé.
Pour une sauvegarde durable, utiliser `MICHEL_BACKUP_RECIPIENT` avec une clé `age`.

### Supprimer les volumes et réinstaller

Toujours vérifier le dossier avant la commande destructive :

```bash
ssh michel-nas
cd /home/drsam/michel-os
pwd
docker compose ps
```

La commande `pwd` doit afficher exactement `/home/drsam/michel-os`. Ensuite :

```bash
docker compose down --volumes --remove-orphans
docker compose up -d --build \
  bootstrap postgres mosquitto go2rtc ai api worker dashboard homeassistant
```

Le service Zigbee2MQTT est volontairement absent de cette commande, car il nécessite un
coordinateur physiquement connecté. Élise détecte automatiquement le port stable et le pilote :

```bash
./scripts/detect-zigbee-adapter.sh --write-env .env
adapter="$(sed -n 's/^ZIGBEE_ADAPTER=//p' .env)"
test -e "$adapter" && docker compose up -d zigbee2mqtt
```

La détection reconnaît notamment les familles Texas Instruments (`zstack`), Silicon Labs
(`ember`), ConBee (`deconz`), ZiGate et ZBOSS. Lorsqu'une seule clé inconnue est branchée,
le pilote est confié à l'auto-détection native de Zigbee2MQTT. Si plusieurs ports série sont
présents, l'installation s'arrête avant toute suppression et demande un choix explicite.

Pour un coordinateur réseau ou un modèle particulier, conserver une configuration explicite :

```dotenv
ZIGBEE_ADAPTER_MODE=manual
ZIGBEE_ADAPTER=tcp://192.168.1.20:6638
ZIGBEE_ADAPTER_TYPE=zstack
```

### Validation finale

```bash
docker compose ps
docker compose logs --tail=100 api worker homeassistant
curl --fail http://127.0.0.1:8090/api/v1/system/health
```

Puis ouvrir <http://192.168.1.55:8090> et créer le premier compte administrateur.

## 6. Diagnostic rapide

```bash
# Tous les conteneurs et leur état
ssh michel-nas 'cd /home/drsam/michel-os && docker compose ps -a'

# Journaux des services principaux
ssh michel-nas \
  'cd /home/drsam/michel-os && docker compose logs --tail=150 api worker dashboard homeassistant'

# Espace disque disponible
ssh michel-nas 'df -h / && docker system df'

# Redémarrage applicatif sans supprimer les données
ssh michel-nas \
  'cd /home/drsam/michel-os && docker compose restart api worker dashboard'
```

Ne pas utiliser `docker compose down --volumes` pour un simple redémarrage : l'option
`--volumes` est précisément celle qui efface toutes les données persistantes de l'installation.
