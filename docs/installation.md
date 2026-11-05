# Installer Élise OS

Élise fonctionne sur Raspberry Pi 4/5 ou sur un serveur Ubuntu 24.04. Dans les deux cas, les données restent au domicile et l’accès extérieur passe uniquement par le réseau privé Tailscale de la famille.

## Raspberry Pi 4 ou 5

Prévoyez de préférence un Raspberry Pi 4 avec 8 Go de mémoire (un Pi 5 8 Go convient aussi) et un stockage de 32 Go. Avec 4 Go, Élise démarre, mais l’écran TV et les appels vidéo laissent trop peu de marge. Un SSD USB ou un NVMe sur Pi 5 est recommandé.

1. Installez Raspberry Pi Imager sur votre ordinateur.
2. Dans « Système d’exploitation », choisissez « Utiliser une image personnalisée » puis l’image `elise-os-…img.xz` de la dernière version GitHub. Le fichier `os_list.json` publié avec chaque version peut aussi servir de dépôt personnalisé.
3. Dans les réglages d’Imager, indiquez le nom `elise`, votre Wi-Fi, le pays, le fuseau horaire et, si nécessaire, votre clé SSH.
4. Écrivez l’image, placez le stockage dans le Raspberry Pi et démarrez-le.
5. Ouvrez [http://elise.local](http://elise.local), ou l’app Élise sur un téléphone connecté au même Wi-Fi : le boîtier s’annonce sur le réseau dès la préparation. La page « Préparation d’Élise » suit chaque étape et le nombre de composants téléchargés, puis laisse automatiquement place à l’assistant.
6. Associez Tailscale depuis l’assistant. Jitsi, Chromium plein écran, la sortie HDMI/DisplayPort et les permissions caméra/micro se terminent alors automatiquement, sans seconde commande.

Branchez la clé Zigbee quand vous voulez, avant ou après l’installation. Élise la reconnaît à son nom quand c’est possible ; sinon elle essaie chaque famille de pilotes Zigbee2MQTT (Silicon Labs, Texas Instruments, ZiGate, deCONZ, ZBOSS), retient celui qui répond et relance Zigbee2MQTT. Débrancher la clé arrête proprement Zigbee2MQTT. L’état est consultable dans `/var/lib/elise/zigbee/status.json`.

Une coupure d’Internet n’empêche pas le Raspberry Pi de démarrer. La page locale indique le problème et l’installation reprend automatiquement quand Internet revient.

## Ubuntu Server 24.04

Sur un serveur AMD64 ou ARM64 avec 8 Go de mémoire conseillés (4 Go au minimum) et 32 Go de stockage :

```bash
curl -fsSL https://github.com/Elise-OS/EliseOS/releases/latest/download/install-elise.sh | sudo bash
```

L’installateur vérifie la machine, installe Docker, Tailscale et Avahi, vérifie le manifeste de version, télécharge les images adaptées à l’architecture et attend que les services soient sains. Il conserve une installation déjà présente, ses secrets, volumes, sauvegardes et son identité Tailscale.

Cette commande installe également tout le paquet TV et appels vidéo. Si Tailscale n’est pas encore associé, un service local reprend automatiquement la préparation chaque minute et la termine dès que l’accès privé est prêt.

Depuis une copie locale du dépôt, la commande complète équivalente est :

```bash
bash scripts/install-complete.sh
```

Commandes utiles :

```bash
elise status
elise logs
elise update
elise backup
elise restore /var/lib/elise/backups/elise-AAAA.tar.age --confirm
elise uninstall
```

`elise uninstall` conserve les données. La suppression définitive nécessite l’option explicite `--purge` et ne déconnecte jamais Tailscale.

Les sauvegardes de production doivent être chiffrées. Ajoutez une clé publique `age` dans `ELISE_BACKUP_RECIPIENT` dans `/etc/elise/elise.env` avant d’exécuter `elise backup`.

## Mise à jour sûre

Élise vérifie les releases GitHub toutes les six heures. Une nouvelle version apparaît dans
**Réglages → Général → Mise à jour d’Élise OS** (et par un « ! » dans le menu) ; un
administrateur, sur le réseau local ou Tailscale, choisit quand l’installer. `elise update` fait la
même chose en ligne de commande.

Chaque mise à jour :

- n’accepte que la dernière release stable, plus récente que la version installée (un retour à une
  version plus ancienne est refusé : sa base de données ne comprendrait pas les migrations récentes ;
  `ELISE_ALLOW_DOWNGRADE=true elise update --version vX.Y.Z` reste possible à la main) ;
- vérifie l’empreinte et la signature Sigstore de l’archive et du manifeste, émises par
  `release.yml` sur `main`, puis télécharge les images par empreinte (`@sha256:…`) ;
- sauvegarde la base, garde la version précédente, puis attend que l’API réponde avec la nouvelle
  version ;
- sur toute erreur, remet le lien `current`, `/etc/elise/elise.env`, les agents système, les
  conteneurs et la base de la version précédente ;
- ne garde ensuite que la version installée et la précédente, et supprime les images inutilisées.

Lancée depuis le tableau de bord, la mise à jour tourne dans l’unité systemd
`elise-update-install`, indépendante de l’agent et des conteneurs qu’elle redémarre. Journal :
`/var/lib/elise/update/install.log`.

Les appareils en v0.1.11 ou avant doivent passer une fois à la nouvelle version en SSH : leur agent
ne sait pas installer depuis le tableau de bord, leur `elise update` confond la version d’Élise avec
celle d’Ubuntu, et leur pare-feu Tailscale coupe le DNS dès que Tailscale est connecté. On lance
donc directement l’installateur signé de la dernière release.

Rétablir le DNS jusqu’au prochain redémarrage (inutile si Tailscale n’est pas connecté) :

```bash
sudo nft insert rule inet elise_remote input ct state established,related accept
```

Télécharger l’installateur et vérifier sa signature :

```bash
cd "$(mktemp -d)" && curl -fsSLO https://github.com/Elise-OS/EliseOS/releases/latest/download/install-elise.sh && curl -fsSLO https://github.com/Elise-OS/EliseOS/releases/latest/download/install-elise.sh.sigstore.json
```

```bash
cosign verify-blob install-elise.sh --bundle install-elise.sh.sigstore.json --certificate-identity-regexp '^https://github.com/Elise-OS/EliseOS/.github/workflows/release.yml@refs/heads/main$' --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Installer :

```bash
sudo ELISE_SKIP_SYSTEM_PACKAGES=true bash install-elise.sh
```

L’installateur remplace le pare-feu et redémarre les agents : les mises à jour suivantes se font
depuis le tableau de bord.

### Dépôt privé (facultatif)

Le dépôt Élise OS, ses releases et ses images sont publics : aucun compte n’est nécessaire. Pour
une distribution depuis un dépôt privé, créez un compte bot limité à la lecture du dépôt et des
packages, puis un PAT classic avec `repo` et `read:packages`.

Sur Raspberry Pi, deux possibilités :

- au premier démarrage, la page « Préparation d’Élise » (http://elise.local) demande le nom du
  compte bot et son jeton, les vérifie auprès de GitHub puis reprend l’installation ;
- ou, juste après l’écriture de la carte, créez sur la partition de démarrage (`system-boot`,
  lisible depuis Windows et macOS) un fichier `elise-github-auth.txt` :

```text
username=elise-os-bot
token=ghp_…
```

Au démarrage, Élise le déplace dans `/etc/elise/github-auth` (`root:root`, `0600`) et l’efface de
la partition de démarrage. Sur Ubuntu, créez directement `/etc/elise/github-auth` avec ces droits.

Sur une installation déjà démarrée, le compte peut être remplacé depuis **Réglages → Général**.
Le jeton n’est jamais enregistré dans la base Élise ni inclus dans une image publiée.
