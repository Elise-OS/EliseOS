# Chemin lumineux de nuit

Quand la personne se lève la nuit, une lumière douce et chaude s’allume automatiquement sur son trajet (par exemple chambre → couloir → toilettes), puis s’éteint toute seule. L’objectif est d’éviter de marcher dans le noir et de limiter le risque de chute nocturne.

> **Ce n’est pas un dispositif médical.** Le chemin lumineux est une lumière d’appoint pour se déplacer la nuit. Il ne détecte pas les chutes, ne garantit pas qu’une chute sera évitée et ne remplace ni l’éclairage habituel du logement ni une téléassistance.

## Matériel

> **Le ruban Innr FL 230 C est le modèle documenté, mais tout éclairage Zigbee compatible Zigbee2MQTT fonctionne, sans pont du fabricant.**

- **Modèle documenté** : ruban LED Zigbee 3.0 **Innr FL 230 C** (3 m, couleurs et blanc variable, adaptateur secteur inclus, découpable, dos adhésif, intensité réglable de 0,1 à 100 %). Il s’appaire directement sur la clé Zigbee d’Élise : aucun pont Innr ni application n’est nécessaire. Fiche Zigbee2MQTT : <https://www.zigbee2mqtt.io/devices/FL_230_C.html>. Il figure au catalogue avec la compatibilité « documentée » : il n’a pas encore été testé physiquement avec Élise.
- **N’importe quel autre éclairage** : ruban, ampoule ou veilleuse Zigbee reconnu par Zigbee2MQTT, et plus largement toute entité `light.*` de Home Assistant. Élise reconnaît les éclairages par leur capacité « éclairage », jamais par leur modèle.
  - Un éclairage qui ne règle ni l’intensité ni la teinte (simple marche/arrêt) s’allume et s’éteint simplement : Élise ne lui envoie ni intensité, ni température de couleur, ni transition.
  - Un éclairage qui règle l’intensité mais pas la teinte reçoit seulement l’intensité.
  - La température de couleur demandée est ramenée dans la plage que l’éclairage accepte.
- **Alternative moins chère** : IKEA ORMANÄS L2112 (bande LED 4 m couleur et blanc, 24,99 € sur ikea.fr), fiche Zigbee2MQTT : <https://www.zigbee2mqtt.io/devices/L2112.html>.
- **Déclencheur** : un détecteur de mouvement ou de présence dans la pièce de départ (en général la chambre), et éventuellement un capteur de lit.

Les prix et liens d’achat sont dans la [liste d’achat](liste-achat-domadoo.md#option-chemin-lumineux--relevée-le-27-novembre-2026).

### Installer un éclairage

L’éclairage s’ajoute dans une pièce exactement comme un capteur : **Mon logement → la pièce → Éclairage → Installer ce capteur**, puis Zigbee. Pour le ruban Innr :

1. Déroulez entièrement le ruban avant de le brancher (la notice interdit de l’alimenter enroulé ou dans son emballage).
2. Lancez la recherche Zigbee dans Élise, puis branchez le ruban près de la box.
3. S’il ne s’associe pas, réinitialisez-le comme le montre la notice Innr : un appui sur le bouton du contrôleur, puis un appui maintenu 5 secondes ; le ruban clignote deux fois quand il est prêt.

Placement conseillé : au ras du sol, sous le lit ou le long du couloir, **lumière dirigée vers le sol** pour éclairer les pas sans éblouir.

## Réglages

Dans l’espace aidant, **Mon logement → carte « Chemin lumineux »** ouvre la fenêtre de réglage (lecture pour tous les membres, modification par le propriétaire et les administrateurs, comme les règles d’alerte). Sur l’application mobile, voir la section correspondante de l’application.

Pour chaque chemin :

| Réglage           | Rôle                                                                                                                             | Valeur par défaut          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Pièces de départ  | Une ou plusieurs pièces équipées d’un détecteur de mouvement ou de présence.                                                     | La chambre si elle en a un |
| Sortie du lit     | Démarre aussi quand le capteur de lit d’une pièce de départ indique que le lit est libre.                                        | Activé                     |
| Plage horaire     | Début et fin de la nuit, passage de minuit compris. Hors plage, rien ne s’allume.                                                | 22:00 → 07:00              |
| Pièces à éclairer | Une ou plusieurs pièces, **y compris sans détecteur** : il suffit qu’elles aient un éclairage. Toutes leurs lumières s’allument. | Les pièces équipées        |
| Intensité         | De 5 à 100 %.                                                                                                                    | 25 %                       |
| Teinte            | Très chaude (2 200 K), chaude (2 700 K) ou douce (3 000 K), si l’éclairage le permet.                                            | Très chaude                |
| Extinction        | Après 1, 3, 5 ou 10 minutes sans mouvement sur le trajet.                                                                        | 3 minutes                  |

Plusieurs chemins peuvent coexister (par exemple chambre → toilettes et séjour → cuisine). Chacun peut être mis en pause, modifié ou supprimé, et s’affiche avec une phrase claire : « La nuit, de 22 h à 7 h, quand Jeanne bouge dans la chambre : chambre, couloir et toilettes s’allument doucement. »

Le bouton **Tester** allume les pièces choisies pendant 20 secondes, à n’importe quelle heure, pour vérifier l’installation.

## Fonctionnement

- Le déclenchement a lieu **dans l’API Élise, au moment où l’événement de mouvement arrive** (pas dans le worker, trop lent pour un allumage immédiat). Un événement ancien (rejoué après une reconnexion, plus de 2 minutes) n’allume jamais rien.
- L’allumage est progressif (transition de 2 secondes) quand l’éclairage le permet ; l’extinction aussi.
- Tout mouvement dans une pièce du chemin (pièces de départ ou pièces éclairées équipées d’un détecteur) prolonge l’éclairage. Une présence qui se termine laisse le délai complet à partir de ce moment. Si un détecteur de présence du trajet indique encore quelqu’un à l’heure de l’extinction, Élise attend un nouveau délai (au plus 30 minutes après le dernier signal de présence).
- Un capteur de lit qui indique « lit occupé » ne démarre jamais un chemin et ne le maintient jamais allumé.
- **Lumière déjà allumée** : si une lumière était déjà allumée avant le déclenchement (par la personne elle-même, par exemple), Élise ne la touche pas et ne l’éteindra pas.
- **Redémarrage** : chaque lumière allumée par Élise est enregistrée avec son heure d’extinction. Après un redémarrage de la box, les lumières dont le délai est dépassé sont éteintes quelques secondes après le retour du réseau.
- Désactiver ou supprimer un chemin éteint immédiatement les lumières qu’il avait allumées.
- Les changements sont journalisés (création, modification, suppression, test).

## Limites

- **Pas un dispositif médical**, aucune garantie de prévention des chutes. Gardez un éclairage normal accessible depuis le lit.
- **Dépend du réseau Zigbee** et de la réactivité des détecteurs : un détecteur de mouvement sur pile peut mettre une à deux secondes à signaler un mouvement, et un réseau Zigbee instable peut retarder ou perdre une commande. Un ruban branché sur le secteur renforce en général le maillage Zigbee, mais ce rôle n’est pas confirmé par la documentation du fabricant.
- Une pièce éclairée **sans détecteur** s’éteint après le délai, même si la personne y est encore : choisissez un délai plus long ou ajoutez un détecteur (par exemple dans les toilettes).
- Un **radar de présence** dans la chambre peut détecter la personne couchée et rallumer le chemin pendant le sommeil : préférez un détecteur de mouvement près du sol, orienté vers la descente du lit, ou un capteur de lit.
- Si la personne allume elle-même une lumière **pendant** qu’un chemin l’a déjà allumée, Élise ne peut pas faire la différence et l’éteindra à la fin du délai.
- Sans liaison avec la box (coupure de courant ou réseau), rien ne s’allume.
- Les éclairages Wi-Fi, Matter ou Z-Wave exposés par Home Assistant fonctionnent en principe de la même façon, mais seul le cas Zigbee2MQTT est documenté.

## Pour les développeurs

- Contrats : `packages/contracts/src/night-path.ts` (schémas, plage horaire, données envoyées à la lumière).
- API : `apps/api/src/modules/night-path/` (`GET/POST /api/v1/night-paths`, `PATCH/DELETE /api/v1/night-paths/:id`, `POST /api/v1/night-paths/test`), tables Prisma `NightLightPath` et `NightLightActivation`, colonne `DeviceEntity.lightFeatures`.
- Pont Home Assistant : `docker/homeassistant/custom_components/elise_bridge/mapping.py` (`light_payload`, `light_features`).
- Interface : `apps/dashboard/src/NightPathDialog.tsx` et la carte « Chemin lumineux » de `HomeOverview`.
