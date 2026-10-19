# Liste d'achat Domadoo — pilote Michel

Vérification des prix et disponibilités : 16 août 2026. Les prix et stocks peuvent évoluer.

## Panier recommandé pour un premier logement

| Quantité | Produit                                                                                                                                                                                                           | Usage prévu                                        | Prix unitaire constaté | Sous-total |
| -------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------: | ---------: |
|        1 | [SONOFF ZBDongle-E — coordinateur Zigbee USB](https://www.domadoo.fr/fr/dongle-zigbee/6315-sonoff-dongle-usb-zigbee-30-antenne-externe-v2-zbdongle-e-compatible-home-assistant-et-zigbee2mqtt-6920075777659.html) | Relie tous les capteurs à Michel                   |                17,21 € |    17,21 € |
|        4 | [SONOFF SNZB-03P — détecteur de mouvement](https://www.domadoo.fr/fr/securite/6923-sonoff-detecteur-de-mouvement-zigbee-30-compatible-zigbee2mqtt-snzb-03p.html)                                                  | Entrée, couloir, séjour et chambre                 |                10,22 € |    40,88 € |
|        3 | [SONOFF SNZB-04P — ouverture porte/fenêtre](https://www.domadoo.fr/fr/produits-de-domotique/7058-sonoff-capteur-de-porte-ou-fenetre-zigbee-30-snzb-04p.html)                                                      | Porte d'entrée et deux ouvrants importants         |                 9,99 € |    29,97 € |
|        2 | [SONOFF SNZB-02P — température et humidité](https://www.domadoo.fr/fr/chauffage-connecte/6732-sonoff-capteur-de-temperature-et-d-humidite-zigbee-30-avec-support.html)                                            | Séjour et chambre                                  |                 9,99 € |    19,98 € |
|        1 | [SONOFF SNZB-01P — bouton sans fil](https://www.domadoo.fr/fr/peripheriques/6733-sonoff-snzb-01p-bouton-sans-fil-zigbee-30-compatible-ewelink-et-home-assistant.html)                                             | Bouton SOS de démonstration                        |                 7,43 € |     7,43 € |
|        1 | [SONOFF SNZB-05P avec câble 2 m — fuite d'eau](https://www.domadoo.fr/fr/produits-de-domotique/7184-sonoff-detecteur-d-inondation-zigbee-ip67-cable-de-detection-2m-6920075779875.html)                           | Sous évier ou près du lave-linge                   |                11,69 € |    11,69 € |
|        1 | [SONOFF SNZB-06P — présence radar](https://www.domadoo.fr/fr/alarme-connectee/6827-sonoff-capteur-de-presence-humaine-zigbee-30-technologie-radar-snzb-06p.html)                                                  | Présence fine dans le séjour, même sans mouvement  |                11,99 € |    11,99 € |
|        2 | [ThirdReality — prise Zigbee avec mesure de consommation](https://www.domadoo.fr/fr/produits-zigbee/8904-thirdreality-prise-zigbee-mesure-consommation-type-f-compatible-home-assistant-16a-e2-850001595759.html) | Renforce le réseau Zigbee et mesure deux appareils |                13,99 € |    27,98 € |

**Total indicatif : 167,13 €**, hors livraison et rallonge USB.

## À ajouter au panier

- Une rallonge USB de 1 à 2 mètres pour éloigner le coordinateur Zigbee du Raspberry Pi et limiter les interférences USB 3/Wi-Fi. Domadoo la recommande également sur la fiche du ZBDongle-E.
- Un petit stock de piles CR2477 de marque fiable. Les capteurs SONOFF ci-dessus utilisent cette référence ; les piles incluses permettent toutefois de commencer.
- Des adhésifs de fixation de rechange si le logement impose plusieurs essais de placement.

## Ordre d'installation conseillé

1. Coordinateur Zigbee et deux prises alimentées, afin de former l'ossature du réseau.
2. Capteurs de mouvement et d'ouverture.
3. Température, fuite d'eau et bouton SOS.
4. Radar de présence, après validation des zones couvertes et de l'emplacement d'alimentation USB.

## Points à vérifier avant la commande

- Le SNZB-02P était annoncé en réapprovisionnement sur sa fiche lors de la vérification. S'il n'est toujours pas disponible, le [capteur température/humidité ThirdReality](https://www.domadoo.fr/fr/450_thirdreality) est le remplacement conseillé, mais il coûte davantage.
- Le micrologiciel du ZBDongle-E doit être récent pour Zigbee2MQTT 2.x. Suivre le [guide de mise à jour Domadoo](https://blog.domadoo.fr/110828-comment-mettre-a-jour-un-dongle-zigbee/) avant l'appairage si nécessaire.
- Le bouton SNZB-01P est adapté au pilote, mais ce n'est pas un dispositif médical certifié ni une téléassistance disposant de sa propre liaison de secours.
- Ne pas commander de caméra pour le moment. Le logiciel gère désormais mieux la confidentialité et les autorisations, mais l'audio bidirectionnel et la stabilité RTSP/ONVIF doivent encore être validés sur un modèle physique précis.

## Périmètre couvert

Ce panier couvre les neuf scénarios de simulation de Michel : matinée normale, cycle de porte, porte laissée ouverte, inactivité, température basse, activité nocturne, batterie faible, capteur hors ligne et SOS. Il est dimensionné pour un premier logement pilote, pas pour un déploiement industriel.

## Option sécurité incendie — relevée le 2 octobre 2026

| Quantité | Produit                                                                                                                                                                                | Usage prévu                                                            | Prix unitaire constaté | Disponibilité affichée                       |
| -------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------: | -------------------------------------------- |
|        1 | [HEIMAN HS1SA-E — détecteur de fumée Zigbee 3.0, certifié EN14604](https://www.domadoo.fr/fr/peripheriques/6291-heiman-detecteur-de-fumee-intelligent-zigbee-30-certifie-en14604.html) | Sirène locale et remontée d’alerte fumée dans Élise OS via Zigbee2MQTT |            18,99 € TTC | Réapprovisionnement estimé le 6 octobre 2026 |

Cette option est en plus du total du panier pilote ci-dessus. Vérifier la référence **HS1SA-E** lors de la commande : l’installation Élise utilise directement son réseau Zigbee, sans compte ni concentrateur Heiman.
