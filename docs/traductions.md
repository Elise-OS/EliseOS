# Traductions

Les textes d’Élise sont écrits en français, puis traduits. Chaque langue a son propre catalogue : le code ne contient plus de textes, seulement des clés.

```tsx
<Text>{t('dashboardApp.alertTitle.smokeDetected')}</Text>
<Text>{t('formatters.minAgo', { minutes })}</Text> // « Il y a {{minutes}} min »
<Text>{t('mobileHomePlanPanel.sensorCount', { count })}</Text> // pluriels selon la langue
```

## Où sont les textes

| Endroit                                | Rôle                                                              |
| -------------------------------------- | ----------------------------------------------------------------- |
| `packages/i18n/src/index.ts`           | Liste des langues (`LANGUAGES`) et moteur i18next commun          |
| `packages/i18n/src/flags.ts`           | Drapeau de chaque langue, dessiné pareil sur le web et dans l’app |
| `apps/mobile/src/i18n/locales/fr.json` | Textes de l’app mobile, la référence                              |
| `apps/mobile/src/i18n/locales/en.json` | Leur traduction anglaise                                          |
| `eliselanding/src/i18n/languages.ts`   | Langues et drapeaux du menu de la landing                         |

Le dashboard web, la TV et l’API gardent encore leurs textes en paires français/anglais dans le code ; ils passeront aux catalogues de la même façon (voir `packages/i18n/scripts/migrate-bilingual.mjs`).

## Ajouter une langue (exemple : l’espagnol)

1. Dans `packages/i18n/src/index.ts`, ajouter la ligne de la langue :
   `{ code: 'es', name: 'Español', dateLocale: 'es-ES' }`.
2. Dans `packages/i18n/src/flags.ts`, ajouter son drapeau (TypeScript le réclame).
3. Copier `apps/mobile/src/i18n/locales/en.json` en `es.json` et traduire les valeurs, jamais les clés.
4. Dans `apps/mobile/src/i18n/index.ts`, importer `es.json` et l’ajouter à `createI18n({ fr, en, es })`.
5. Vérifier : `pnpm --filter @elise/mobile i18n:check`, puis `typecheck` et `test`.
6. Pour l’App Store : ajouter `apps/mobile/fastlane/metadata/es-ES/`, puis les captures (voir plus bas).

Le sélecteur de langue (accueil et Réglages de l’app, assistant et réglages du dashboard) affiche la nouvelle langue tout seul, avec son drapeau. Le dashboard ne la propose qu’une fois ses textes migrés.

Pour la landing, qui vit dans un autre dépôt, ajouter aussi la langue et son drapeau dans `eliselanding/src/i18n/languages.ts`.

## Règles de traduction

- **`{{valeur}}`** : à garder tel quel, à la place qui convient dans la phrase. Une traduction peut omettre une valeur ou en utiliser une que le français n’utilise pas, tant que le code la fournit (le vérificateur le contrôle).
- **Pluriels** : une clé `…_one` / `…_other` (et les autres formes de la langue : `_few`, `_many`…) reçoit `{{count}}`. Le vérificateur signale les formes manquantes pour chaque langue.
- **Blocs `…copy`** : textes d’un écran lus d’un seul tenant ; garder la même structure (mêmes champs, listes de même longueur).
- **Sécurité** : les textes des alertes (chute, fumée, fuite d’eau, monoxyde de carbone, bouton d’assistance) doivent être relus par une personne dont c’est la langue maternelle.

## Ce que le vérificateur contrôle

`pnpm --filter @elise/mobile i18n:check` lit les catalogues et le code :

- une langue de `LANGUAGES` sans catalogue, ou un catalogue d’une langue absente de la liste ;
- une clé manquante ou en trop par rapport au français ;
- un `{{valeur}}` qu’aucun appel `t()` ne fournit ;
- une forme de pluriel manquante (avertissement : i18next retombe alors sur l’anglais) ;
- un texte qu’aucun appel `t()` n’utilise plus (avertissement).

TypeScript refuse en plus toute clé `t('…')` qui n’existe pas dans `fr.json`.

## Langue au démarrage

Au premier lancement, l’app prend la langue du téléphone si Élise la parle, l’anglais sinon. Le choix fait ensuite sur l’écran d’accueil ou dans Réglages → Général est gardé. L’API répond en anglais à toute langue autre que le français, en attendant d’en parler d’autres.

## Captures App Store

```bash
bash apps/mobile/scripts/store-screenshots.sh <chemin vers lise.app> fr
bash apps/mobile/scripts/store-screenshots.sh <chemin vers lise.app> en
```

Pour une nouvelle langue, ajouter son cas dans le script (`STORE_LOCALE`, `DEVICE_LOCALE`) et ses libellés dans `apps/mobile/.maestro/store-labels.js`.
