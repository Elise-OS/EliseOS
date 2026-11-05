# Traductions

Les textes d’Élise sont écrits en français, puis traduits. Chaque bloc a un catalogue par langue : le code ne contient plus de textes, seulement des clés.

```tsx
<Text>{t('dashboardApp.alertTitle.smokeDetected')}</Text>
<Text>{t('formatters.minAgo', { minutes })}</Text> // « Il y a {{minutes}} min »
<Text>{t('mobileHomePlanPanel.sensorCount', { count })}</Text> // pluriels selon la langue
```

Pour faire traduire par une personne ou un agent : **[traductions-agents.md](traductions-agents.md)** (un fichier par bloc, `pnpm i18n:export` puis `pnpm i18n:import`).

## Les trois blocs

| Bloc                                | Catalogues                                    | Langues et drapeaux                                 |
| ----------------------------------- | --------------------------------------------- | --------------------------------------------------- |
| `mobile` (app iPhone/iPad, Android) | `apps/mobile/src/i18n/locales/<code>.json`    | `packages/i18n/src/index.ts` et `flags.ts`          |
| `web` (dashboard, assistant, TV)    | `apps/dashboard/src/i18n/locales/<code>.json` | les mêmes, partagés avec le mobile                  |
| `landing` (site et documentation)   | `eliselanding/src/i18n/locales/<code>.json`   | `eliselanding/src/i18n/languages.ts` (dépôt séparé) |

`fr.json` est la référence de chaque bloc. Un texte absent d’une traduction s’affiche en anglais, puis en français.

Les données partagées (catégories de capteurs, types de contact, humeurs, pictogrammes de rendez-vous) ont leurs libellés dans les catalogues, rangés par identifiant ; `@elise/contracts` garde ses champs `label`/`labelEn` pour le serveur. Le catalogue des capteurs du dashboard (`sensorProducts.<id>`) est vérifié par un test contre `apps/dashboard/src/sensor-products.ts`.

## Ajouter une langue (exemple : l’espagnol)

**App mobile et dashboard**

1. Dans `packages/i18n/src/index.ts`, ajouter `{ code: 'es', name: 'Español', dateLocale: 'es-ES' }` à `LANGUAGES`.
2. Dans `packages/i18n/src/flags.ts`, ajouter son drapeau (TypeScript le réclame).
3. `pnpm i18n:export es`, faire traduire `translations/es/mobile.json` et `web.json`, puis `pnpm i18n:import es`.
4. Importer `es.json` dans `apps/mobile/src/i18n/index.ts` et `apps/dashboard/src/i18n/index.ts` (`createI18n({ fr, en, es })`).
5. Pour l’App Store : `apps/mobile/fastlane/metadata/es-ES/`, puis les captures (voir plus bas).

**Landing**

1. Dans `eliselanding/src/i18n/languages.ts`, ajouter la langue et son drapeau.
2. Faire traduire `translations/es/landing.json`, puis `pnpm i18n:import es` ; importer `es.json` dans `eliselanding/src/i18n/catalog.ts`.
3. Les pages `/es/`, `/es/download/`, `/es/setup/`… sont créées toutes seules (mêmes adresses que l’anglais, sous `/es/`), comme le menu de langue et les `hreflang`.
4. La documentation suit la même liste : ses pages non traduites s’affichent en français avec l’avis de Starlight. Pour les traduire, copier `src/content/docs/en/` en `src/content/docs/es/`.

Les sélecteurs de langue (accueil et Réglages de l’app, assistant et réglages du dashboard, bandeau de la démo, en-tête du site) proposent la nouvelle langue tout seuls, avec son drapeau.

Enfin, `pnpm i18n:check` puis, dans chaque app, `typecheck` et `test`.

## Règles de traduction

- **`{{valeur}}`** : à garder tel quel, à la place qui convient dans la phrase. Une traduction peut omettre une valeur ou en utiliser une que le français n’utilise pas, tant que le code la fournit (le vérificateur le contrôle).
- **Pluriels** : une clé `…_one` / `…_other` (et les autres formes de la langue : `_few`, `_many`…) reçoit `{{count}}`. Le vérificateur signale les formes manquantes pour chaque langue.
- **Blocs** (`…copy`, listes) : lus d’un seul tenant mais texte par texte, avec retour à l’anglais pour un texte manquant.
- **Sécurité** : les textes des alertes (chute, fumée, fuite d’eau, monoxyde de carbone, bouton d’assistance) doivent être relus par une personne dont c’est la langue maternelle.

## Ce que le vérificateur contrôle

`pnpm i18n:check` vérifie les trois blocs (ou `pnpm --filter @elise/mobile i18n:check`, `pnpm --filter @elise/dashboard i18n:check`) :

- une langue de `LANGUAGES` sans catalogue, ou un catalogue d’une langue absente de la liste ;
- une clé manquante ou en trop par rapport au français ;
- un `{{valeur}}` qu’aucun appel `t()` ne fournit ;
- une forme de pluriel manquante (avertissement : i18next retombe alors sur l’anglais) ;
- un texte qu’aucun appel `t()` n’utilise plus (avertissement ; pas pour la landing, qui lit ses textes comme des objets).

Dans le mobile et le dashboard, TypeScript refuse en plus toute clé `t('…')` qui n’existe pas dans `fr.json`.

## Langue au démarrage

- **App mobile** : la langue du téléphone si Élise la parle, l’anglais sinon ; le choix fait ensuite sur l’écran d’accueil ou dans Réglages → Général est gardé.
- **Dashboard** : `?lang=` dans l’adresse, puis le choix gardé dans le navigateur, le français sinon.
- **API** : elle répond en anglais à toute langue autre que le français, en attendant d’en parler d’autres.

## Outils de migration

Les scripts qui ont sorti les textes du code restent dans `packages/i18n/scripts/` pour le reste à migrer (l’API notamment) : `migrate-bilingual.mjs` (paires `tr('fr', 'en')`, `fr ? … : …`) et `migrate-pair-tables.mjs` (tables `{ CLÉ: ['fr', 'en'] }`).

## Captures App Store

```bash
bash apps/mobile/scripts/store-screenshots.sh <chemin vers lise.app> fr
bash apps/mobile/scripts/store-screenshots.sh <chemin vers lise.app> en
```

Pour une nouvelle langue, ajouter son cas dans le script (`STORE_LOCALE`, `DEVICE_LOCALE`) et ses libellés dans `apps/mobile/.maestro/store-labels.js`.
