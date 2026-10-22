# Installer Élise OS

Élise fonctionne sur Raspberry Pi 4/5 ou sur un serveur Ubuntu 24.04. Dans les deux cas, les données restent au domicile et l’accès extérieur passe uniquement par le réseau privé Tailscale de la famille.

## Raspberry Pi 4 ou 5

Prévoyez un modèle avec au moins 4 Go de mémoire et un stockage de 32 Go. Un SSD USB ou un NVMe sur Pi 5 est recommandé.

1. Installez Raspberry Pi Imager sur votre ordinateur.
2. Dans « Système d’exploitation », choisissez « Utiliser une image personnalisée » puis l’image `elise-os-…img.xz` de la dernière version GitHub. Le fichier `os_list.json` publié avec chaque version peut aussi servir de dépôt personnalisé.
3. Dans les réglages d’Imager, indiquez le nom `elise`, votre Wi-Fi, le pays, le fuseau horaire et, si nécessaire, votre clé SSH.
4. Écrivez l’image, placez le stockage dans le Raspberry Pi et démarrez-le.
5. Ouvrez [http://elise.local](http://elise.local). La page « Préparation d’Élise » affiche les téléchargements puis laisse automatiquement place à l’assistant.
6. Associez Tailscale depuis l’assistant. Jitsi, Chromium plein écran, la sortie HDMI/DisplayPort et les permissions caméra/micro se terminent alors automatiquement, sans seconde commande.

Une coupure d’Internet n’empêche pas le Raspberry Pi de démarrer. La page locale indique le problème et l’installation reprend automatiquement quand Internet revient.

## Ubuntu Server 24.04

Sur un serveur AMD64 ou ARM64 avec au moins 4 Go de mémoire et 32 Go de stockage :

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

Les sauvegardes de production doivent être chiffrées. Ajoutez une clé publique `age` dans `MICHEL_BACKUP_RECIPIENT` dans `/etc/elise/elise.env` avant d’exécuter `elise backup`.

## Mise à jour sûre

`elise update` télécharge une version signée, conserve la version précédente et vérifie la santé du dashboard et de l’API. Si le démarrage échoue, le lien `current`, le fichier d’environnement et les conteneurs reviennent à la version précédente.

### Première installation depuis une release privée

Les images et releases GitHub d’Élise OS sont privées. Créez un compte bot limité à la lecture
du dépôt et des packages, puis un PAT classic avec `repo` et `read:packages`.

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
