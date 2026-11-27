# Mode canicule

Quand il fait très chaud, Élise passe en **mode canicule** : la TV rappelle doucement de boire et donne quelques conseils simples au fil de la journée, et la famille est prévenue. Le mode s’active tout seul quand la chaleur s’installe, et s’arrête tout seul quand elle retombe.

> **Ce n’est pas un dispositif médical.** Le mode canicule aide à penser aux bons gestes pendant les fortes chaleurs. Il ne surveille pas la santé de la personne, ne mesure ni sa température ni son hydratation, et ne remplace ni les visites, ni les appels, ni une téléassistance. En cas de malaise, appelez le 15 ou le 112.

## Quand le mode s’active

Le mode canicule s’active dès que l’une de ces conditions est remplie :

| Déclencheur               | Condition                                                                                                        | Valeur par défaut        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Chaleur dans le logement  | Au moins une pièce équipée d’un capteur de température reste au-dessus du seuil pendant la durée choisie.        | 28 °C pendant 30 minutes |
| Prévision météo           | La température maximale annoncée pour aujourd’hui ou demain, dans la ville choisie pour la TV, atteint le seuil. | 33 °C                    |
| À la main, par la famille | Bouton **Activer maintenant** sur la carte « Mode canicule » de l’accueil (web ou application mobile).           | —                        |

- **Capteurs** : Élise utilise les capteurs de température déjà installés dans les pièces (par exemple les capteurs température/humidité Zigbee). Un relevé de plus d’1 h 30 n’est plus pris en compte.
- **Météo** : la prévision vient de la même source que la météo affichée à la TV, **Open-Meteo**, gratuite et sans compte. La ville est celle des réglages météo de la TV. Élise la relève tous les quarts d’heure ; sans Internet, elle garde la dernière prévision reçue (la prévision « demain » de la veille sert encore pour aujourd’hui).
- **Sans Internet**, le déclencheur « chaleur dans le logement », les rappels à la TV et l’alerte à la famille continuent de fonctionner : tout est calculé sur la box.

### Quand il s’arrête

Le mode se désactive tout seul quand la chaleur est vraiment retombée : **toutes les pièces restent sous le seuil moins 1 °C (27 °C par défaut) pendant 2 heures**, et la prévision d’aujourd’hui et de demain repasse sous son seuil. Cet écart évite que le mode s’allume et s’éteigne sans arrêt autour du seuil.

- Activé **à la main**, le mode reste actif jusqu’à ce que la famille le désactive.
- Désactivé **à la main** pendant un épisode de chaleur, il reste en pause jusqu’à ce que la chaleur retombe, puis se réarme tout seul pour la prochaine fois.

## Sur la TV de la personne

- **Un bandeau ambré en haut de l’écran**, doux et jamais alarmant : « Il fait très chaud aujourd’hui. Pensez à boire un verre d’eau. »
- **Un conseil selon le moment de la journée**, sous le bandeau :
  - le matin (8 h – 12 h) : « Fermez les volets et les fenêtres pour garder le frais » ;
  - dans la journée (12 h – 20 h 30) : « Rafraîchissez-vous le visage et les bras avec un peu d’eau » ;
  - le soir (20 h 30 – 23 h), seulement s’il fait plus frais dehors que dans le logement : « Vous pouvez ouvrir les fenêtres ».
- **Un rappel « boire » toutes les 2 heures, de 9 h à 20 h**, avec une petite mélodie, bien plus discrète que la sonnerie d’appel. Un grand bouton **« C’est fait »** se valide avec le bouton de la télécommande (ou OK). Sans réponse, le rappel s’efface tout seul au bout de 10 minutes. Aucun rappel la nuit.

Pendant un appel ou quand la TV est en veille, ni bandeau ni rappel ne s’affichent.

## Pour la famille

- **Une notification** quand le mode s’active (contenu minimal : « Élise · Mode canicule activé ») ; le détail reste dans l’application.
- **Une alerte « Forte chaleur »** si une pièce reste à **31 °C ou plus pendant 1 heure** (réglable). Elle apparaît dans la page Alertes comme les autres, avec la pièce et la température, et se prend en charge de la même façon.
- **La carte « Mode canicule » de l’accueil** (espace aidant web et application mobile) indique :
  - si le mode est activé, en veille ou en pause, et pourquoi ;
  - la température maximale de la journée dans le logement, et la pièce la plus chaude ;
  - la prévision d’aujourd’hui et de demain pour la ville de la TV ;
  - les rappels « boire » du jour confirmés et restés sans réponse, et l’heure du prochain ;
  - les boutons **Activer maintenant** / **Désactiver** et **Réglages**.
- **Le registre canicule de la mairie** : chaque année, de juin à août ou à la première activation du mode, la carte rappelle que les mairies tiennent un registre des personnes âgées, isolées ou fragiles qui souhaitent être appelées pendant les fortes chaleurs. L’inscription est gratuite et facultative, et un proche peut la demander auprès de la mairie ou du CCAS. Un lien mène à la page officielle de service-public.gouv.fr ; le bouton « C’est fait » masque ce rappel jusqu’à l’année suivante.

## Réglages

La fenêtre **Réglages** de la carte (web) ou de la fiche « Mode canicule » (application mobile) permet de régler chaque option et de la couper séparément. Un résumé en phrases simples se met à jour pendant les réglages.

| Option                   | Ce qu’on règle                                      | Par défaut              |
| ------------------------ | --------------------------------------------------- | ----------------------- |
| Chaleur dans le logement | Seuil (24 à 40 °C) et durée (10 min à 4 h)          | Activé, 28 °C, 30 min   |
| Prévision météo          | Maximum annoncé (25 à 45 °C)                        | Activé, 33 °C           |
| Rappels « boire »        | Toutes les 1, 2 ou 3 h ; première et dernière heure | Activé, 2 h, 9 h – 20 h |
| Conseils                 | Afficher ou non les conseils sous le bandeau        | Activé                  |
| Alerte forte chaleur     | Seuil (26 à 40 °C) et durée (15 min à 6 h)          | Activé, 31 °C, 1 h      |

Qui peut faire quoi :

- tous les membres de la famille voient la carte ;
- le propriétaire, les administrateurs et les aidants peuvent activer ou désactiver le mode à la main ;
- seuls le propriétaire et les administrateurs modifient les réglages.

Chaque changement (réglages, activation ou désactivation à la main, registre) est noté dans le journal.

## Limites

- **Pas un dispositif médical.** Le mode canicule ne remplace ni un avis médical, ni les consignes officielles, ni une présence humaine. Il ne sait pas si la personne a vraiment bu : « C’est fait » est une réponse de la personne, pas une mesure.
- **Dépend des capteurs** : sans capteur de température, seul le déclencheur météo et l’activation à la main fonctionnent, et la carte n’affiche pas de température intérieure. Un capteur placé au soleil ou près d’une source de chaleur fausse les relevés.
- **Dépend du réseau** : la prévision météo a besoin d’Internet et d’une ville renseignée dans les réglages météo de la TV ; les notifications sur téléphone ont besoin d’une connexion. Sans liaison avec la box (coupure de courant ou réseau), la TV garde le dernier état connu et les rappels ne sont plus envoyés.
- **Vigilance Météo-France** : les niveaux officiels de vigilance canicule ne sont pas encore repris ; ils sont prévus pour une étape suivante.

## Pour les développeurs

- Contrats : `packages/contracts/src/heatwave.ts` (schéma des réglages, règles d’activation et d’arrêt, rappels, conseils, registre) et `heatwave-demo.ts` (démos web et mobile).
- API : `apps/api/src/modules/heatwave/` — `GET /api/v1/heatwave`, `PUT /api/v1/heatwave/settings`, `POST /api/v1/heatwave/manual`, `POST /api/v1/heatwave/registry`, `GET /api/v1/heatwave/screen`, `POST /api/v1/heatwave/reminders/:id/confirm`, et pour la TV appairée `GET /api/v1/screen-device/heatwave` et `POST /api/v1/screen-device/heatwave/reminders/:id/confirm`. Migration Prisma `20261127120000_heatwave_mode`.
- Worker : `apps/worker/src/heatwave.ts` évalue chaque minute, à partir de la base seule, l’état du mode, les rappels et l’alerte `heatwave-indoor`.
- Interface : `apps/dashboard/src/heatwave/` (carte, fenêtre de réglages, bandeau et rappel TV) ; mobile : `apps/mobile/src/heatwave/`.
- Démo : `?canicule=on` ouvre la démo web pendant un épisode de chaleur (`EXPO_PUBLIC_HEATWAVE_DEMO=on` pour l’application mobile) ; sinon le visiteur peut activer le mode depuis la carte.
