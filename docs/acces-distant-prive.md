# Accès à distance privé

Élise n’est jamais publiée sur Internet. Il n’existe pas de mode Funnel dans Élise OS. Le téléphone ou l’ordinateur de l’aidant doit être connecté à Tailscale et invité par la famille.

## Activation en quatre étapes

1. Au domicile, ouvrez l’assistant initial ou **Réglages → Accès à distance**, puis choisissez **Activer l’accès privé**.
2. Ouvrez le lien Tailscale affiché et rattachez la machine au compte de la famille. Aucune clé n’est incluse dans Élise OS.
3. Élise détecte la validation et active son adresse `https://elise.…ts.net:8443`. Le port 443 et les autres services du serveur ne sont pas modifiés.
4. Testez le lien depuis un téléphone connecté à Tailscale.

Le dashboard HTTPS passe par le port 8443. La caméra et l’interphone utilisent le port 8555 en TCP/UDP avec les tickets temporaires, rôles et autorisations Élise habituels. PostgreSQL, MQTT, Home Assistant, Swagger et la création initiale ne sont pas publiés par la passerelle distante.

## Inviter un aidant

1. Créez d’abord l’aidant dans Élise et choisissez son rôle.
2. Dans l’administration Tailscale, partagez uniquement la machine Élise avec son adresse e-mail.
3. Envoyez l’invitation et demandez-lui d’installer Tailscale sur son téléphone ou son ordinateur.
4. Envoyez le lien privé ou faites scanner le QR code depuis Réglages. L’app ouvre automatiquement `michel://connect?url=…` et mémorise les adresses locale et distante de la même installation.

Pour une machine domestique permanente, la famille peut désactiver l’expiration de clé uniquement pour le serveur Élise. La révocation dans Tailscale coupe immédiatement le chemin réseau ; désactiver le compte dans Élise coupe aussi sa session et ses droits.

L’image applique une règle hôte stricte sur l’interface `tailscale0` : seuls 8443/TCP et 8555/TCP+UDP sont acceptés. L’administration SSH doit donc être effectuée depuis le réseau local ou la console du serveur.

Références officielles : [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve), [partage d’une machine](https://tailscale.com/kb/1084/sharing), [expiration des clés](https://tailscale.com/docs/features/access-control/key-expiry).
