# Mode canicule

Quand il fait très chaud, Élise passe en **mode canicule** : la TV rappelle doucement de boire et donne quelques conseils simples au fil de la journée, et la famille est prévenue. Le mode s’active tout seul quand la chaleur s’installe, et s’arrête tout seul quand elle retombe.

**La personne n’a rien à appuyer** : la TV affiche seulement des rappels, qui s’effacent tout seuls. Elle ne demande jamais de réponse ni de confirmation.

> **Ce n’est pas un dispositif médical.** Le mode canicule aide à penser aux bons gestes pendant les fortes chaleurs. Il ne surveille pas la santé de la personne, ne mesure ni sa température ni son hydratation, et ne remplace ni les visites, ni les appels, ni une téléassistance. En cas de malaise, appelez le 15 ou le 112.

## Où le trouver

Dans l’espace aidant, **Réglages → onglet Canicule**, à côté des onglets Général, Clé Zigbee, Santé de la box et Règles. Sur l’application mobile, **Réglages → Canicule** : une ligne de la liste des réglages (avec l’état du mode) ouvre un écran dédié, avec un bouton de retour. L’onglet montre, de haut en bas :

- **l’état du mode**, en grand : activé (en ambre), en veille (bleu calme) ou en pause, avec la raison en clair (« Forte chaleur annoncée à Lyon : 34 °C »), l’heure ou le jour d’activation, et ce que fait Élise en ce moment (bandeau ambré à la TV, un verre d’eau toutes les 2 h, conseils selon l’heure, famille alertée dès 31 °C) ou ce qu’elle surveille (logement dès 28 °C, météo dès 33 °C) ;
- les boutons **Activer maintenant** / **Désactiver** et **Modifier les réglages** ;
- **Aujourd’hui** : température maximale dans le logement et pièce la plus chaude, prévision d’aujourd’hui et de demain pour la ville de la TV, et la frise des rappels « boire » de la journée (déjà affichés, prochain, à venir) ;
- **Vos réglages** : les seuils enregistrés résumés en une ligne chacun (déclenchement, arrêt automatique, rappels, conseils, alerte), avec un bouton **Modifier** ;
- **Comment ça marche**, en quatre étapes illustrées écrites à partir des réglages enregistrés : Élise détecte la chaleur, la TV rappelle de boire, la famille est prévenue, tout s’arrête seul ;
- le rappel annuel du **registre canicule de la mairie**, quand c’est la saison ;
- en pied de page, la mention « pas un dispositif médical » (en cas de malaise, le 15 ou le 112).

## Quand le mode s’active

Le mode canicule s’active dès que l’une de ces conditions est remplie :

| Déclencheur               | Condition                                                                                                        | Valeur par défaut        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Chaleur dans le logement  | Au moins une pièce équipée d’un capteur de température reste au-dessus du seuil pendant la durée choisie.        | 28 °C pendant 30 minutes |
| Prévision météo           | La température maximale annoncée pour aujourd’hui ou demain, dans la ville choisie pour la TV, atteint le seuil. | 33 °C                    |
| À la main, par la famille | Bouton **Activer maintenant** de l’onglet Canicule des Réglages (web ou application mobile).                     | —                        |

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
- **Un rappel « boire » toutes les 2 heures, de 9 h à 20 h** : une petite mélodie, bien plus discrète que la sonnerie d’appel, et un message « C’est le moment de boire un verre d’eau. Quelques gorgées suffisent, même sans avoir soif. » Le message s’efface tout seul au bout de 10 minutes. Aucun rappel en dehors de ces heures.

La personne n’a rien à faire : aucun bouton, aucune question, rien n’attend de réponse. Pendant un appel ou quand la TV est en veille, ni bandeau ni rappel ne s’affichent.

## Pour la famille

- **Une notification** quand le mode s’active (contenu minimal : « Élise · Mode canicule activé ») ; le détail reste dans l’application.
- **Une alerte « Forte chaleur »** si une pièce reste à **31 °C ou plus pendant 1 heure** (réglable). Elle apparaît dans la page Alertes comme les autres, avec la pièce et la température, et se prend en charge de la même façon.
- **L’onglet Canicule des Réglages** (espace aidant web et application mobile), décrit plus haut.
- **Le registre canicule de la mairie** : chaque année, de juin à août ou à la première activation du mode, l’onglet rappelle que les mairies tiennent un registre des personnes âgées, isolées ou fragiles qui souhaitent être appelées pendant les fortes chaleurs. L’inscription est gratuite et facultative, et un proche peut la demander auprès de la mairie ou du CCAS. Un lien mène à la page officielle de service-public.gouv.fr ; le bouton « Ne plus afficher cette année » masque ce rappel jusqu’à l’année suivante.

## Réglages

Le bouton **Modifier les réglages** (ou **Modifier**, dans « Vos réglages ») de l’onglet Canicule ouvre une fenêtre (web) ou une fiche (application mobile) qui permet de régler chaque option et de la couper séparément. Un résumé en phrases simples se met à jour pendant les réglages.

| Option                   | Ce qu’on règle                                      | Par défaut              |
| ------------------------ | --------------------------------------------------- | ----------------------- |
| Chaleur dans le logement | Seuil (24 à 40 °C) et durée (10 min à 4 h)          | Activé, 28 °C, 30 min   |
| Prévision météo          | Maximum annoncé (25 à 45 °C)                        | Activé, 33 °C           |
| Rappels « boire »        | Toutes les 1, 2 ou 3 h ; première et dernière heure | Activé, 2 h, 9 h – 20 h |
| Conseils                 | Afficher ou non les conseils sous le bandeau        | Activé                  |
| Alerte forte chaleur     | Seuil (26 à 40 °C) et durée (15 min à 6 h)          | Activé, 31 °C, 1 h      |

Qui peut faire quoi :

- tous les membres de la famille voient l’onglet Canicule et ses explications ;
- le propriétaire, les administrateurs et les aidants peuvent activer ou désactiver le mode à la main ;
- seuls le propriétaire et les administrateurs modifient les réglages.

Chaque changement (réglages, activation ou désactivation à la main, registre) est noté dans le journal.

## Limites

- **Pas un dispositif médical.** Le mode canicule ne remplace ni un avis médical, ni les consignes officielles, ni une présence humaine. Il rappelle de boire, mais ne sait pas si la personne a bu.
- **Dépend des capteurs** : sans capteur de température, seul le déclencheur météo et l’activation à la main fonctionnent, et l’onglet n’affiche pas de température intérieure. Un capteur placé au soleil ou près d’une source de chaleur fausse les relevés.
- **Dépend du réseau** : la prévision météo a besoin d’Internet et d’une ville renseignée dans les réglages météo de la TV ; les notifications sur téléphone ont besoin d’une connexion. Sans liaison avec la box (coupure de courant ou réseau), la TV garde le dernier état connu et les rappels ne sont plus envoyés.
- **Vigilance Météo-France** : les niveaux officiels de vigilance canicule ne sont pas encore repris ; ils sont prévus pour une étape suivante.

## Pour les développeurs

- Contrats : `packages/contracts/src/heatwave.ts` (schéma des réglages, règles d’activation et d’arrêt, rappels, conseils, registre) et `heatwave-demo.ts` (démos web et mobile).
- API : `apps/api/src/modules/heatwave/` — `GET /api/v1/heatwave`, `PUT /api/v1/heatwave/settings`, `POST /api/v1/heatwave/manual`, `POST /api/v1/heatwave/registry`, `GET /api/v1/heatwave/screen`, et pour la TV appairée `GET /api/v1/screen-device/heatwave` (lecture seule : la TV n’envoie rien). Migration Prisma `20261127130000_heatwave_mode`.
- Worker : `apps/worker/src/heatwave.ts` évalue chaque minute, à partir de la base seule, l’état du mode, les rappels (affichés puis effacés à leur heure de fin) et l’alerte `heatwave-indoor`.
- Interface : `apps/dashboard/src/heatwave/` (`HeatwavePanel.tsx` : onglet « Canicule » des Réglages ; fenêtre de réglages, bandeau et rappel TV) ; mobile : `apps/mobile/src/heatwave/` (`HeatwavePanel.tsx` : ligne de la liste des Réglages et écran Canicule ; fiche de réglages).
- Démo : `?canicule=on` ouvre la démo web pendant un épisode de chaleur, avec la météo de la TV assortie (34 °C annoncés à Lyon) ; `EXPO_PUBLIC_HEATWAVE_DEMO=on` (ou `?canicule=on` sur la version web) fait de même pour l’application mobile. Sinon, le visiteur peut activer le mode depuis l’onglet Canicule.
