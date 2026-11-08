# Clé Zigbee

L’onglet **Réglages → Clé Zigbee** montre la clé utilisée par la box Élise et permet d’en installer une autre. Il est réservé aux propriétaires et administrateurs du foyer.

## Pour la famille

1. Branchez la clé sur la box Élise. Une rallonge USB est conseillée, surtout près d’un port USB 3.
2. Ouvrez **Réglages → Clé Zigbee**. L’écran surveille la box tant qu’il reste ouvert ; le bouton **Détecter** permet de relancer immédiatement la recherche.
3. Si plusieurs clés sont présentes, choisissez celle à utiliser. Si le modèle ne peut pas être distingué par son nom USB, Élise interroge la clé sans modifier son contenu. Si elle ne répond pas, l’écran propose les technologies possibles avec une explication.
4. Confirmez l’installation. Lors d’un remplacement, gardez le réseau existant pour donner aux capteurs la meilleure chance de rester associés. Une migration dépend toutefois du coordinateur et de son micrologiciel ; un nouvel appairage peut rester nécessaire.
5. Élise sauvegarde la configuration et `coordinator_backup.json`, configure Zigbee2MQTT, le redémarre puis vérifie le coordinateur. Si la vérification échoue, l’ancienne configuration est remise automatiquement.

L’écran affiche le modèle, la technologie, l’état du service, le micrologiciel, le canal, le PAN ID, l’IEEE et le nombre d’appareils. Les ports, débits et autres détails sont regroupés dans **Détails techniques** ou **Mode avancé**.

Les coordinateurs réseau peuvent être découverts sur le réseau local (mDNS `_slzb-06._tcp` et `_zigstar_gw._tcp`) ou saisis sous la forme `tcp://adresse:6638`. Avant installation, Élise vérifie que l’adresse répond.

## Modèles et technologies connus

La base versionnée se trouve dans `appliance/elise-zigbee-adapters.json`. Elle associe les indices USB et réseau à la technologie Zigbee2MQTT, au débit et au contrôle de flux.

| Famille                                         | Puce ou variante   | Technologie Zigbee2MQTT |       Débit habituel |
| ----------------------------------------------- | ------------------ | ----------------------- | -------------------: |
| Sonoff ZBDongle-P                               | CC2652P            | `zstack`                |               115200 |
| Sonoff ZBDongle-E, Dongle Lite MG21             | EFR32MG21          | `ember`                 |               115200 |
| Sonoff ZBDongle-Max                             | EFR32MG24          | `ember`                 |               115200 |
| SMLIGHT SLZB-06, 06p7, 06p10, 07, 07p7          | CC2652             | `zstack`                |               115200 |
| SMLIGHT SLZB-06M, 07Mg24                        | EFR32              | `ember`                 |               115200 |
| SMLIGHT SLZB-MR                                 | multi-radio        | choix proposé           |       selon la radio |
| Home Assistant SkyConnect / Connect ZBT-1       | EFR32MG21          | `ember`                 |               115200 |
| Home Assistant Connect ZBT-2                    | EFR32MG24          | `ember`                 |               460800 |
| ConBee II / III, RaspBee II                     | dresden elektronik | `deconz`                |               115200 |
| ConBee première génération                      | dresden elektronik | `deconz`                |                38400 |
| ZiGate USB-TTL                                  | ZiGate             | `zigate`                |               115200 |
| Electrolama zzh, TubesZB CC2652, ZigStar UZG-01 | CC2652             | `zstack`                |               115200 |
| TubesZB EFR32                                   | EFR32              | `ember`                 |               115200 |
| CC2531                                          | CC2531             | `zstack`                |  115200, déconseillé |
| Nordic nRF52840                                 | nRF52840           | `zboss`                 | 115200, expérimental |

Les convertisseurs CP210x, CH340, CH9102 et FTDI génériques sont affichés même sans modèle reconnu. Comme un même convertisseur équipe des radios incompatibles, son VID:PID seul ne déclenche jamais une installation hasardeuse.

`ezsp` n’est pas proposé : les coordinateurs Silicon Labs récents utilisent `ember`. Élise signale aussi les modèles expérimentaux ou déconseillés et rappelle de maintenir le micrologiciel à jour.

## Conception technique

### Séparation de sécurité

L’API Nest tourne en conteneur et n’accède pas directement à `/dev`. Un agent hôte dédié, `appliance/elise-zigbee-agent.py`, possède le strict accès matériel nécessaire et écoute sur `/run/elise-zigbee/agent.sock`. Le socket est monté dans le conteneur API ; aucune commande arbitraire n’est acceptée. Le protocole ne contient que les opérations `status`, `scan`, `probe`, `network_test`, `network_forget`, `install`, `install_status` et `cancel`.

Les routes `/api/v1/zigbee/adapter…` appliquent la capacité `configuration:manage` et le même contrôle de passerelle que les réglages système. Elles ne sont donc accessibles qu’aux propriétaires et administrateurs autorisés.

### Détection

L’agent rassemble plusieurs signaux au lieu de se fier au seul nom du port :

- liens stables `/dev/serial/by-id`, puis `/dev/serial/by-path` en repli ;
- VID:PID, fabricant, produit et numéro de série lus dans sysfs/udev ;
- pilote noyau, port réellement résolu, stabilité du chemin et processus qui l’occupe ;
- annonces mDNS des coordinateurs réseau et adresses mémorisées ;
- correspondances exactes ou pondérées de la base de modèles.

Le scan retourne toutes les clés, y compris les clés inconnues, occupées ou multiples. Un branchement/débranchement déclenche aussi l’unité systemd par udev. Le lien `by-id` permet de retrouver la même clé après un redémarrage ou un changement de numéro `ttyUSB`.

### Ambiguïtés et sonde

Les CP2102N et CH9102 peuvent par exemple équiper un ZBDongle-P (`zstack`) ou un ZBDongle-E (`ember`). Dans ce cas l’identité reste `ambiguous`. À la demande de l’utilisateur, l’agent :

1. prend un verrou global et vérifie que le port n’est pas utilisé par un autre programme ;
2. arrête temporairement Zigbee2MQTT seulement si la clé testée est celle qu’il utilise ;
3. envoie une sonde minimale propre à chaque protocole (`MT ping`, `ASH reset`, version deCONZ ou ZiGate) et ne fait aucune écriture de firmware ou de réseau ;
4. redémarre le service arrêté dans tous les cas.

Une réponse valide sélectionne la technologie. Sans réponse sûre, l’interface laisse la famille choisir dans les options plausibles. Le mode avancé accepte aussi un port, une technologie, un débit et RTS/CTS explicites.

### Installation et rollback

L’installation est sérialisée par verrou et exposée comme une tâche suivie : contrôle, sauvegarde, configuration, redémarrage, vérification. Avant toute modification, l’agent copie `elise.env`, la configuration Zigbee2MQTT et `coordinator_backup.json` dans une sauvegarde horodatée. Un journal de transaction permet de restaurer au prochain démarrage si l’agent est interrompu.

L’agent écrit uniquement les variables Zigbee autorisées (`ZIGBEE_ADAPTER`, `ZIGBEE_ADAPTER_TYPE`, `ZIGBEE_SERIAL_PORT`, `ZIGBEE_BAUDRATE`, `ZIGBEE_RTSCTS`), recrée Zigbee2MQTT et attend :

- un conteneur en fonctionnement ;
- `zigbee2mqtt/bridge/state = online` ;
- `zigbee2mqtt/bridge/info` avec type, révision, IEEE, canal et identifiants PAN cohérents.

En mode **Garder le réseau**, `network_key`, `pan_id` et `ext_pan_id` ne sont pas régénérés. Si le nouveau coordinateur refuse ce réseau, l’interface explique qu’une migration ou un nouvel appairage peut être nécessaire. En mode **Nouveau réseau**, une confirmation explicite avertit que les capteurs devront être ré-appairés.

Tout échec restaure les fichiers sauvegardés et redémarre l’ancien service. Le résultat distingue notamment port occupé, clé débranchée, absence de Zigbee2MQTT, mauvaise technologie, absence de réponse, réseau incompatible, délai dépassé, annulation et échec du rollback.

### API et démo

- `GET /zigbee/adapter` : clé actuelle, santé, coordinateur, nombre d’appareils, candidats et tâche en cours ;
- `POST /zigbee/adapter/scan` : recherche USB et, sur demande, réseau ;
- `POST /zigbee/adapter/probe` : identification sûre d’un candidat ambigu ;
- `POST /zigbee/adapter/network/test` et `/network/forget` : gestion des adresses réseau ;
- `POST /zigbee/adapter/install`, `GET /install`, `POST /install/cancel` : lancement, progression et annulation.

Le dashboard et l’app mobile utilisent les mêmes schémas, aides de présentation et simulateur de `packages/contracts`. La démo commence avec un Sonoff ZBDongle-E sain ; **Détecter** fait apparaître une seconde clé ambiguë, puis simule la sonde et toutes les étapes d’installation. Une technologie volontairement incorrecte simule un échec et le rollback.

## Vérifications et dépannage

Les tests Python couvrent la base, la détection multi-signal, les ports occupés, les sondes, la génération de configuration, les sauvegardes et le rollback. Les tests TypeScript couvrent les contrats, le simulateur, l’API et les droits.

Sur une box, les premiers contrôles sont :

```bash
systemctl status elise-zigbee-agent.service elise-zigbee-setup.service
journalctl -u elise-zigbee-agent.service -u elise-zigbee-setup.service
ls -l /dev/serial/by-id /run/elise-zigbee/agent.sock
docker compose ps zigbee2mqtt
```

L’utilisateur du service doit pouvoir ouvrir le port série (groupe `dialout`). Une clé occupée n’est jamais arrachée à son processus. Si Zigbee2MQTT est absent ou arrêté, l’onglet reste consultable et donne un message précis au lieu de tenter une installation incomplète. En mode démo, aucune opération matérielle ou réseau réelle n’est effectuée.
