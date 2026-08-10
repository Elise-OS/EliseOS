# Roadmap d'exécution — Élise OS jusqu'à la v0.8

Date de l'audit : 9 août 2026  
Périmètre : dépôt `/Users/paulbreton/Desktop/Michel`  
Source produit : roadmap complète « Élise OS — Système local d'assistance pour proches aidants »

## 1. Objectif de cette roadmap

Cette roadmap remplace le planning théorique par un plan d'exécution fondé sur le code réellement présent.

L'objectif de la prochaine session Goal est de construire le maximum de fonctionnalités cohérentes jusqu'à la v0.8, dans cet ordre :

1. sécuriser la base actuelle ;
2. fermer la simulation v0.4 ;
3. rendre le flux capteurs v0.5 exploitable ;
4. terminer un moteur d'alertes déterministe v0.6 ;
5. livrer un parcours médicaments v0.7 complet ;
6. brancher ces données dans le dashboard premium v0.8 ;
7. maintenir une qualité de design premium à chaque incrément ;
8. terminer sur une base compilable, testée et documentée.

La création initiale de l'environnement est considérée comme une base existante à préserver et à consolider, pas comme un chantier à recommencer.

## 2. Contraintes de travail

- Élise reste local-first, sans dépendance cloud obligatoire.
- Aucun diagnostic médical ni promesse de sécurité absolue.
- L'interface utilisateur porte le nom **Élise OS**. Le namespace technique historique `michel` peut rester interne jusqu'après la v0.8 pour éviter un renommage risqué.
- PostgreSQL est conservé : le dépôt est déjà architecturé et migré autour de Prisma/PostgreSQL. Revenir à SQLite pendant cette nuit créerait du travail sans valeur produit immédiate.
- Home Assistant, Mosquitto et Zigbee2MQTT restent des moteurs internes, invisibles dans l'expérience familiale normale.
- Pas de création d'image Raspberry, de portail Wi-Fi, d'OTA ou d'accès distant dans ce cycle.
- Pas de travail de v0.9 sur Élise AI, sauf correction indispensable d'une régression existante.
- Pas de contrôle via navigateur. Les validations de cette session doivent passer par inspection du code, tests automatisés en ligne de commande, compilation et contrôles statiques.
- Ne pas écraser les changements déjà présents. Le dépôt n'a actuellement aucun commit et tous les fichiers sont non suivis ; un point de reprise devra être établi avant une longue série de modifications si l'utilisateur autorise un commit local.

### 2.1 Contrat design obligatoire

Le design n'est pas un lot de finition de v0.8. Toute fonctionnalité qui ajoute ou modifie une interface doit passer sa **Design Gate** dans le même lot que le backend correspondant.

#### Direction visuelle à conserver

- Impression générale : calme, premium, chaleureuse, familiale et rassurante.
- Ne jamais évoquer un tableau de bord médical, un centre de surveillance ou une interface domotique technique.
- Palette principale existante : crème `#f5f0e8`, papier `#fdfbf7`, bleu nuit `#0b2948`/`#12385f`, bleu doux `#376884`, ambre/doré `#d99a55`.
- Le rouge doux reste réservé aux situations réellement urgentes ou destructives.
- Le vert ne doit jamais devenir une couleur de marque dominante. Un état normal privilégie le bleu, le neutre et une formulation calme.
- Titres éditoriaux en `Source Serif 4`/Georgia ; textes, libellés et contrôles en Inter/system UI.
- Ombres légères, bordures chaudes, rayons cohérents et densité aérée.
- Icônes Lucide cohérentes, jamais purement décoratives quand elles portent un sens.

#### Règles UX pour chaque écran

- Une action principale maximum par carte ou section.
- Hiérarchie lisible : contexte court, titre humain, détail utile, action éventuelle.
- Aucun enum, identifiant de capteur, topic MQTT ou terme Home Assistant présenté tel quel à la famille.
- Les phrases répondent d'abord à « que se passe-t-il ? », puis « dois-je agir ? ».
- Prévoir systématiquement les états chargement, vide, succès, attention, erreur, données insuffisantes et hors-ligne.
- Ne jamais utiliser uniquement la couleur pour transmettre un statut ; ajouter libellé et icône.
- Conserver des cibles tactiles confortables, un focus clavier visible, des labels explicites et un contraste suffisant.
- Le contenu français est la référence. Les nouveaux textes anglais doivent rester complets quand l'écran est bilingue.
- Le design doit rester cohérent à partir de 320 px, puis tablette et desktop, sans créer une version mobile appauvrie.

#### Design Gate obligatoire pour chaque lot UI

Avant de déclarer une tâche d'interface terminée, vérifier dans le code et les tests de composants :

1. réutilisation des tokens et composants communs plutôt que nouvelles valeurs arbitraires ;
2. hiérarchie typographique et espacements cohérents ;
3. états vide/chargement/erreur/données insuffisantes ;
4. libellés humains et non médicaux ;
5. comportement responsive défini dans le CSS ;
6. navigation clavier, labels, rôles et focus ;
7. absence de régression sur les composants voisins ;
8. rendu statique des variantes importantes couvert par les tests quand c'est pertinent.

L'absence de contrôle via navigateur signifie que la validation de nuit s'appuie sur l'architecture des composants, l'inspection CSS, les tests de rendu statique et les contrôles d'accessibilité codables. Toute validation visuelle humaine restant nécessaire doit être signalée explicitement dans le rapport final, sans prétendre qu'elle a eu lieu.

## 3. Résultat de l'audit actuel

### 3.1 Socle déjà présent

- Monorepo pnpm/Turborepo en TypeScript.
- API NestJS locale avec validation Zod et documentation Swagger.
- PostgreSQL et schéma Prisma couvrant utilisateurs, foyer, résident, pièces, capteurs, observations, habitudes, alertes, journal, visites, rendez-vous, audit et outbox.
- Authentification locale par session HTTP-only et jeton mobile.
- Assistant d'installation Élise en 12 étapes.
- Création atomique du compte principal, du résident, du logement, des pièces, des proches et des premières habitudes.
- Photo du résident stockée localement.
- Dashboard web responsive avec accueil, activité, alertes, pièces, journal, proches, fiche résident et réglages.
- Mise à jour temps réel par SSE et notifications PostgreSQL.
- Application Expo avec découverte locale, connexion et dashboard essentiel.
- Pipeline Zigbee2MQTT → Home Assistant → MQTT → API → PostgreSQL.
- Bridge Home Assistant avec normalisation des mouvements, ouvertures, température, humidité, énergie, batterie et boutons.
- Worker avec outbox, webhooks signés, rétention, inactivité et intégration d'un service local Isolation Forest.
- Scripts de sauvegarde et restauration, avec chiffrement `age` recommandé.
- Docker Compose, overlay Raspberry/mDNS et images multi-architecture prévues.

### 3.2 Validations exécutées

| Contrôle                        | Résultat                                                             |
| ------------------------------- | -------------------------------------------------------------------- |
| `pnpm lint`                     | Réussi                                                               |
| `pnpm typecheck`                | Réussi                                                               |
| `pnpm test`                     | Réussi — 17 tests applicatifs TypeScript                             |
| `pnpm build`                    | Réussi                                                               |
| `docker compose config --quiet` | Réussi                                                               |
| `pnpm format:check`             | Échec — 2 fichiers à reformater                                      |
| Tests Python Élise AI           | Non exécutés localement — `pytest` absent de l'environnement courant |
| Démarrage Compose complet       | Non vérifié — daemon Docker local arrêté                             |

Les tests actuels sont utiles mais encore trop peu nombreux pour les règles métier sensibles. Plusieurs packages déclarent un script de test sans contenir de tests.

### 3.3 État par version

Les pourcentages ci-dessous sont des estimations de couverture fonctionnelle, pas une mesure automatique de qualité.

| Version               | État estimé | Ce qui est réellement fait                                                | Écart principal                                                               |
| --------------------- | ----------: | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| v0.1 — Socle          |        90 % | Web, API, DB, auth, navigation, Compose, sauvegarde                       | Baseline non totalement verte et runtime complet non vérifié                  |
| v0.2 — Résident       |        85 % | Création détaillée, contexte, mobilité, besoins, photo, proches, synthèse | Édition après installation très limitée                                       |
| v0.3 — Logement       |        70 % | Logement, niveaux, pièces, affectation des capteurs                       | Pas de CRUD complet, zones sensibles ni règles par pièce                      |
| v0.4 — Simulation     |        25 % | Seed de démonstration avec quelques événements                            | Pas de simulateur pilotable ni de scénarios normaux/anormaux                  |
| v0.5 — Capteurs réels |        55 % | Infra Zigbee/MQTT/HA, bridge, ingestion, temps réel, affectation          | Appairage non piloté, santé/batterie partielles, hors-ligne incomplet         |
| v0.6 — Alertes        |        35 % | SOS, inactivité, données insuffisantes, anomalies IA, acquittement        | Porte, température, nuit, batterie, règles configurables absentes             |
| v0.7 — Médicaments    |         0 % | Aucun modèle, API ou écran métier                                         | Parcours complet à créer                                                      |
| v0.8 — Dashboard      |        60 % | Design premium, statut, timeline, alertes, pièces, famille, résident      | Résumés 24 h/7 j non branchés, médicaments absents, santé capteurs incomplète |

Conclusion : le produit n'est pas une simple v0.1. Il correspond plutôt à une **v0.3 utilisable avec des fondations avancées de v0.5 et v0.8**, mais les versions intermédiaires ne sont pas encore fermées de bout en bout.

## 4. Défauts et risques à traiter en premier

### P0 — Bloquants techniques

1. **Statuts d'habitudes invalides dans le worker**  
   Le worker écrit `ACTIVE` et `SUPERSEDED`, alors que l'enum Prisma autorise seulement `UNKNOWN`, `PROVIDED`, `LEARNING` et `CONFIRMED`. L'entraînement peut donc écrire le modèle sur disque puis faire échouer la transaction PostgreSQL.

2. **Baseline de formatage rouge**  
   `apps/dashboard/src/FlagIcons.tsx` et `apps/mobile/app.json` ne passent pas Prettier.

3. **Capteurs jamais réellement déclarés hors ligne**  
   L'ingestion remet un capteur à `ONLINE` ou `DEGRADED`, mais aucun processus ne transforme un `lastSeenAt` ancien en `OFFLINE`.

4. **Étape équipements de l'onboarding partiellement trompeuse**  
   La détection lit les capteurs déjà enregistrés. Sur une installation fraîche, le foyer n'existe pas encore et aucun capteur ne peut lui être rattaché. Le bouton d'ajout manuel n'a pas d'action et l'étape de test reflète seulement le statut stocké.

5. **Moteur de règles incomplet**  
   Les types `DOOR_OPEN` existent dans le schéma et les données de démonstration, mais aucune règle réelle ne les crée. Il n'existe pas de règle de température, activité nocturne ou batterie faible.

6. **Couverture de tests trop faible pour le worker**  
   Les boucles SQL et transitions d'alertes ne sont pratiquement pas testées. Le bug d'enum n'est donc pas détecté par la CI actuelle.

### P1 — Risques produit

- Le dashboard peut afficher « tout semble normal » sans avoir une politique de couverture suffisamment stricte pour tous les cas.
- La présence mobile est actuellement présentée comme « à domicile » dès que le foyer existe ; ce libellé doit être dérivé des événements ou rendu plus prudent.
- Les événements de température, humidité et batterie sont traduits en « activité détectée » dans la timeline web.
- Les résumés 24 h et 7 jours existent côté API mais ne sont consommés par aucun écran web.
- Le journal contient un modèle et une lecture API, mais aucun générateur de résumé quotidien réel.
- Les noms Michel/Élise sont mélangés dans les métadonnées, la documentation et la découverte réseau.

## 5. Plan de construction de la nuit

## Gate 0 — Stabiliser la base

Priorité : absolue. Aucun nouveau module métier avant le passage de cette gate.

### Tâches

- Reformater les deux fichiers signalés.
- Corriger le cycle de vie `HabitStatus` sans migration destructive : utiliser les valeurs existantes de manière cohérente et `validTo` pour fermer un ancien profil.
- Ajouter des tests unitaires couvrant l'entraînement éligible et les statuts Prisma utilisés par le worker.
- Encadrer l'accès à `bootstrap-equipment` : local uniquement et indisponible comme endpoint public de découverte après la configuration initiale, sauf session administrateur.
- Harmoniser les valeurs utilisateur visibles vers « Élise OS » sans renommer en masse les packages, variables d'environnement ou topics MQTT.
- Vérifier la génération Prisma et les migrations existantes.
- Centraliser les tokens visuels utilisés par les nouveaux composants et corriger les divergences évidentes sans lancer une refonte globale.

### Critère de sortie

```text
format:check + lint + typecheck + tests + build + compose config = verts
```

Le runtime IA doit être soit testé dans un environnement Python isolé avec les dépendances de `apps/ai[dev]`, soit explicitement déclaré non vérifié dans le rapport final.

### Design Gate 0

- Les corrections de baseline ne changent pas arbitrairement la palette, les fontes ou la densité existantes.
- Tout nouveau message d'erreur ou de sécurité utilise le ton calme et précis d'Élise.
- Les composants partagés restent la source des boutons, cartes, métriques et pastilles de statut.

## Jalon v0.4 — Capteurs simulés et scénarios reproductibles

Objectif : pouvoir développer toutes les règles sans matériel physique et sans écrire directement de fausses lignes dans le dashboard.

### Tâches P0

- Ajouter un mode de simulation explicitement activable par variable d'environnement, désactivé en production par défaut.
- Créer des capteurs simulés mouvement, contact, température, batterie et bouton SOS.
- Faire passer tous les événements simulés par le même contrat normalisé et le même service d'ingestion que les événements Home Assistant.
- Ajouter des scénarios déterministes :
  - matinée normale ;
  - porte ouverte puis refermée ;
  - porte laissée ouverte ;
  - absence prolongée de mouvement ;
  - température basse ;
  - activité nocturne répétée ;
  - batterie faible ;
  - capteur silencieux/hors ligne ;
  - bouton SOS.
- Fournir un déclencheur administrateur minimal dans les réglages ou un script CLI documenté. Une UI ne doit être ajoutée que si elle ne retarde pas le moteur métier.
- Garantir l'idempotence des scénarios et l'isolation par foyer.

### Tests obligatoires

- Un événement rejoué ne crée pas de doublon.
- Un scénario produit les observations attendues avec des dates contrôlables.
- Un scénario d'un foyer ne modifie jamais un autre foyer.
- Le mode simulation est refusé quand il n'est pas activé.

### Critère v0.4

Un administrateur peut déclencher un scénario, voir les événements dans l'activité et obtenir le même résultat à chaque exécution de test.

### Design Gate v0.4

- Les outils de simulation sont clairement identifiés comme outils d'administration/démonstration et ne polluent pas l'accueil familial.
- Les scénarios portent des noms humains et une courte explication du résultat attendu.
- Les états en cours, réussi et échoué sont présents ; aucun bouton ne semble inactif sans explication.

## Jalon v0.5 — Capteurs réels exploitables

Objectif : rendre la chaîne déjà présente opérationnelle et observable, sans exposer Home Assistant à la famille.

### Tâches P0

- Consolider le contrat de découverte : entité, device ID, nom lisible, capability, compatibilité, dernière valeur, batterie et dernière communication.
- Traiter les événements inconnus comme visibles mais inéligibles aux alertes.
- Ajouter un moniteur périodique de santé :
  - `ONLINE` après événement fiable ;
  - `DEGRADED` sur qualité dégradée ;
  - `OFFLINE` après seuil configurable sans communication ;
  - retour automatique à `ONLINE` à la prochaine donnée fiable.
- Exposer la santé, la batterie et la dernière donnée dans l'API foyer.
- Compléter l'affectation capteur → pièce avec validation des droits et journal d'audit.
- Déplacer ou compléter la configuration des équipements après la création effective du foyer. L'installation doit pouvoir se terminer sans matériel, puis reprendre la connexion depuis les réglages.
- Rendre fonctionnel l'ajout manuel ou retirer le bouton tant que le flux n'existe pas.
- Traduire correctement les capabilities dans la timeline.

### Tâches P1 si matériel disponible

- Vérifier un vrai capteur mouvement, contact et température via Zigbee2MQTT.
- Vérifier le redémarrage Mosquitto/Home Assistant/API sans perte de l'affectation aux pièces.
- Documenter l'appairage et la sélection stable `/dev/serial/by-id/...`.

### Critère v0.5

Un capteur simulé et, si le matériel est disponible, un capteur réel remontent par le même pipeline, affichent leur dernière valeur, leur pièce et un état de santé cohérent.

### Design Gate v0.5

- Une carte capteur montre d'abord son nom et sa pièce, puis son état, sa batterie et sa dernière communication.
- Les états `ONLINE`, `DEGRADED`, `OFFLINE` et `UNKNOWN` sont traduits en français clair.
- Les informations techniques avancées sont placées dans un détail secondaire réservé à l'administration.
- L'affectation à une pièce est utilisable au clavier et sur petit écran.

## Jalon v0.6 — Moteur d'alertes déterministe

Objectif : couvrir les situations promises avec des règles explicables avant de s'appuyer sur l'apprentissage automatique.

### Modèle minimal

Créer un modèle de règle ou une configuration typée équivalente avec :

- foyer ;
- type de règle ;
- activation ;
- seuil ;
- fenêtre horaire ;
- pièce ou capteur optionnel ;
- sévérité ;
- délai de persistance ;
- date de modification et auteur.

### Règles P0

1. Absence de mouvement avec couverture capteurs obligatoire.
2. Porte ouverte au-delà d'une durée configurable.
3. Température sous ou au-dessus d'un seuil pendant une durée minimale.
4. Activité nocturne répétée dans une fenêtre configurable.
5. Capteur hors ligne.
6. Batterie faible.
7. Bouton SOS immédiat et idempotent.

### Comportement commun

- Dédupliquer une alerte déjà ouverte pour la même règle et la même cible.
- Résoudre automatiquement quand le retour à la normale est certain.
- Ne jamais convertir une panne de capteur en alerte d'inactivité.
- Enregistrer chaque transition dans `AlertTransition`.
- Produire des explications humaines comprenant le seuil, la durée et la pièce.
- Conserver l'acquittement et la résolution manuelle existants.
- Garder les résultats IA informatifs pendant l'apprentissage et derrière la policy gate après 14 jours.

### Configuration UI P0

- Écran de réglages simple avec activation et seuils des règles.
- Valeurs par défaut prudentes.
- Message clair sur la différence entre information, attention et urgence.
- Pas de jargon MQTT, Zigbee ou Home Assistant.

### Tests obligatoires

- Horloge figée pour chaque seuil temporel.
- Ouverture puis fermeture de porte.
- Température oscillant autour du seuil sans spam.
- Capteur hors ligne bloquant l'inactivité.
- Déduplication et auto-résolution.
- Rejeu d'un SOS sans doublon.
- Isolation des règles entre foyers.

### Critère v0.6

Les scénarios v0.4 déclenchent exactement les alertes attendues, avec un cycle de vie auditable et sans faux message de sécurité lorsque les données sont insuffisantes.

### Design Gate v0.6

- Les niveaux d'alerte ont une hiérarchie visible sans dépendre uniquement de la couleur.
- L'explication, la pièce, l'heure et l'action recommandée se lisent dans cet ordre.
- Une alerte critique reste rare et visuellement forte ; les informations et attentions restent calmes.
- Les formulaires de seuil montrent une unité, une valeur par défaut et un exemple humain.
- Les actions « prendre en charge », « résoudre » et « ignorer » ne peuvent pas être confondues.

## Jalon v0.7 — Médicaments

Objectif : livrer un parcours utile de « pilulier non connecté », entièrement local.

### Modèle de données P0

- `Medication` : résident, nom, dosage, consignes, actif/inactif.
- `MedicationSchedule` : heure locale, jours concernés, date de début/fin optionnelle.
- `MedicationDose` ou `MedicationOccurrence` : prise prévue, statut, confirmation, auteur et date.
- Statuts minimum : `PENDING`, `TAKEN`, `MISSED`, `SKIPPED`.
- Type d'alerte dédié `MEDICATION_MISSED`.

### API P0

- Créer, lire, modifier et désactiver un traitement.
- Créer et modifier ses horaires.
- Lister les prises du jour et l'historique.
- Confirmer ou ignorer une prise avec contrôle des droits.
- Générer les occurrences de manière idempotente dans le fuseau du logement.
- Marquer un oubli potentiel après une marge configurable.
- Ouvrir une seule alerte par prise oubliée et la résoudre lors d'une confirmation tardive.

### Interface P0

- Écran « Médicaments » dans la navigation.
- Carte « aujourd'hui » avec prochaine prise, prises confirmées et retards.
- Formulaire simple de traitement et d'horaire.
- Bouton « Confirmer la prise ».
- Historique chronologique.
- Formulations prudentes : « prise non confirmée » ou « oubli potentiel », jamais « le médicament n'a pas été pris ».

### Tests obligatoires

- Génération quotidienne sans doublon.
- Fuseau Europe/Paris et changement de jour.
- Confirmation normale et tardive.
- Oubli potentiel et résolution de l'alerte.
- Traitement désactivé ou date de fin atteinte.
- Autorisations aidant/lecteur.

### Critère v0.7

Un aidant peut créer un traitement, voir la prise prévue, la confirmer et retrouver l'historique ; une prise non confirmée crée une alerte prudente et dédupliquée.

### Design Gate v0.7

- L'écran médicaments reste chaleureux et non clinique : pas de tableau dense ni de codes hospitaliers.
- La prochaine prise domine la hiérarchie ; l'historique et les réglages restent secondaires.
- Les statuts utilisent « prévue », « confirmée », « non confirmée » et « ignorée » dans un langage prudent.
- La confirmation d'une prise offre un retour immédiat et accessible, sans animation anxiogène.
- Les horaires, dosages et consignes restent lisibles en gros caractères sur mobile/tablette.

## Jalon v0.8 — Dashboard premium utile en dix secondes

Objectif : assembler les briques précédentes dans une lecture claire de la journée et de la semaine.

### Accueil P0

- Statut global calculé à partir des alertes ouvertes et de la couverture capteurs.
- Dernière activité avec phrase humaine et pièce.
- Capteurs hors ligne ou batteries faibles visibles sans dominer l'écran.
- Prochaine prise médicamenteuse et éventuel retard.
- Alerte prioritaire avec actions d'acquittement/résolution.
- Prochain rendez-vous ou prochaine visite.
- État d'apprentissage sur 14 jours sans promesse prématurée de normalité.

### Vue journée et semaine P0

- Brancher l'API `analytics/activity` déjà existante.
- Sélecteur 24 h / 7 jours.
- Totaux par pièce et par type d'activité.
- Résumé déterministe en français : événements marquants, alertes, médicaments, santé capteurs.
- Ne pas appeler ce résumé « IA » tant qu'il est produit par des règles.

### Timeline P0

- Traductions distinctes pour mouvement, ouverture/fermeture, température, humidité, batterie, énergie et bouton.
- Valeur et unité quand elles sont utiles.
- Filtres jour, pièce et type.
- Pagination par curseur avec les endpoints feed existants.
- États vide, erreur, hors-ligne et chargement.

### Alertes et médicaments P0

- Filtres ouvert/acquitté/résolu.
- Sévérité traduite en libellé humain.
- Affichage de la chronologie des transitions.
- Accès direct depuis l'accueil aux alertes et prises concernées.

### Qualité d'interface P1

- Conserver la palette crème, bleu nuit et doré doux déjà en place.
- Vérifier les breakpoints par tests de composants et inspection CSS, sans contrôle via navigateur.
- Navigation clavier, labels, focus visibles et contrastes suffisants.
- Éviter les cartes vides et les informations techniques brutes.
- Découper `App.tsx`, `Setup.tsx` et leurs styles en composants maintenables seulement après fermeture des flux métier P0.

### Critère v0.8

À partir des données simulées, un aidant comprend en moins de dix secondes :

1. si une situation demande son attention ;
2. la dernière activité fiable ;
3. l'état des capteurs ;
4. la prochaine prise ou un oubli potentiel ;
5. l'action immédiate disponible.

### Design Gate v0.8

- La carte de situation actuelle reste le point d'entrée visuel unique.
- Les cinq informations du critère v0.8 sont visibles sans concurrence excessive entre les cartes.
- La vue 24 h/7 j utilise des graphiques sobres, lisibles et accompagnés d'un résumé textuel.
- Les timelines, alertes et médicaments partagent les mêmes règles d'espacement, de statut et d'action.
- Aucun écran principal n'est un placeholder, une grille technique brute ou une accumulation de cartes de même importance.
- Les variantes mobile, tablette et desktop sont définies dans les composants/CSS et couvertes autant que possible par les tests sans navigateur.

## 6. Ordre d'exécution recommandé

| Ordre | Lot          | Nature         | Condition de passage                                 |
| ----: | ------------ | -------------- | ---------------------------------------------------- |
|     1 | Gate 0       | Fiabilité      | Baseline entièrement verte                           |
|     2 | v0.4         | Simulation     | Scénarios reproductibles par le pipeline réel        |
|     3 | v0.5         | Santé capteurs | Online/degraded/offline et batterie exploitables     |
|     4 | v0.6         | Règles         | Sept scénarios déterministes et dédupliqués          |
|     5 | v0.7         | Médicaments    | Traitement → prise → confirmation/oubli → historique |
|     6 | v0.8         | Dashboard      | Données v0.4–v0.7 lisibles en dix secondes           |
|     7 | Finalisation | Qualité        | Tous les contrôles repassent au vert                 |

Ne pas commencer par une refonte visuelle globale. Le dashboard possède déjà une direction crédible : chaque nouvelle donnée métier doit être intégrée proprement dans ce langage visuel, avec sa Design Gate, sans reporter la qualité à la fin.

## 7. Stratégie de coupe si la nuit ne suffit pas

### Minimum acceptable

- Gate 0 verte.
- Simulateur v0.4.
- Santé capteurs v0.5.
- Règles porte, inactivité, température, hors-ligne et SOS.
- Modèle/API médicaments avec prises du jour et confirmation.
- Dashboard branché sur ces données.

### À couper en premier

1. Refonte structurelle globale du CSS, mais jamais la finition du composant fonctionnel en cours.
2. Améliorations de l'application mobile native.
3. Ajout manuel avancé de tous les types de capteurs.
4. Statistiques complexes au-delà de 24 h/7 j.
5. Notifications externes supplémentaires au webhook existant.
6. Règles IA avancées et nouvelles features de modèle.

### À ne jamais couper

- Isolation des données par foyer.
- Idempotence des événements, prises et alertes.
- Distinction panne capteur / inactivité.
- Formulations prudentes sur les médicaments et la sécurité.
- Tests des seuils temporels.
- Migrations Prisma reproductibles.
- Baseline finale verte.
- Design Gate de chaque interface réellement livrée.

## 8. Validation à chaque jalon

À la fin de chaque lot :

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config --quiet
```

Puis effectuer la Design Gate du lot par inspection des composants, styles, textes, variantes d'état et tests de rendu statique. Le rapport doit séparer clairement « vérifié automatiquement » et « validation visuelle humaine à faire ».

Pour toute migration :

```bash
pnpm db:generate
```

Puis vérifier la migration sur une base de test disponible. Ne jamais modifier une migration déjà appliquée ; créer une nouvelle migration additive.

Les tests Python doivent être lancés dès qu'un environnement Python avec les dépendances `apps/ai[dev]` est disponible :

```bash
python -m pytest apps/ai
```

Le démarrage Compose complet et le test matériel sont des validations séparées. Si le daemon Docker ou le Raspberry ne sont pas disponibles, le rapport final doit le dire explicitement et ne pas présenter la v0.5 matérielle comme vérifiée.

## 9. Définition de terminé pour la session Goal

La session est terminée uniquement lorsque :

- chaque lot commencé est soit fini et testé, soit documenté comme incomplet sans masquer ses limites ;
- aucune migration partielle ou incohérente n'est laissée dans le dépôt ;
- les nouvelles routes valident leurs entrées et leurs droits ;
- les règles temporelles disposent de tests à horloge figée ;
- le dashboard n'affiche pas de statut rassurant quand la couverture est insuffisante ;
- chaque interface livrée respecte le contrat design et possède tous ses états utiles ;
- les nouveaux écrans restent cohérents sur les breakpoints définis sans valeur visuelle arbitraire ;
- les contrôles de la section 8 sont repassés ;
- un compte rendu final liste précisément les fichiers modifiés, les fonctions livrées, les contrôles réussis et les validations externes non réalisées.

## 10. Objectif prêt à utiliser en mode Goal

> À partir de `docs/roadmap-v0.8-night.md`, construire le maximum cohérent d'Élise OS jusqu'à la v0.8. Commencer par Gate 0, puis avancer strictement dans l'ordre v0.4, v0.5, v0.6, v0.7 et v0.8. Préserver l'onboarding existant, privilégier les flux verticaux testés, appliquer la Design Gate à chaque interface sans reporter le design à la fin, ne pas travailler sur l'image Raspberry ni la v0.9, ne faire aucun contrôle via navigateur, et ne déclarer terminé que ce qui passe les validations automatisées prévues.
