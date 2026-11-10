# Traduire Élise OS (consignes pour un agent ou un traducteur)

Élise OS aide une famille à garder le lien avec un proche âgé qui vit chez lui : capteurs discrets dans le logement, application pour les aidants, écran sur la télévision du proche. Les textes sont lus par des aidants souvent inquiets et parfois par la personne âgée elle-même.

## Déroulé

```bash
pnpm i18n:export es        # crée translations/es/<bloc>.json avec les textes à traduire
# … remplir le champ "es" de chaque entrée …
pnpm i18n:import es        # range les traductions dans les catalogues
pnpm i18n:check            # signale ce qui manque ou ce qui est cassé
```

Trois fichiers sortent, un par bloc : `mobile.json` (l’app des aidants), `web.json` (le dashboard, l’assistant de création et l’écran TV) et `landing.json` (le site public et son guide d’installation). `pnpm i18n:status` montre l’avancement de chaque langue dans chaque bloc.

Chaque entrée exportée ressemble à :

```json
"formatters.minAgo": {
  "fr": "Il y a {{minutes}} min",
  "en": "{{minutes}} min ago",
  "es": ""
}
```

Ne remplir que le champ de la langue cible. Le français est la source ; l’anglais aide à lever une ambiguïté. Une entrée laissée vide n’est pas importée : l’app affiche alors l’anglais.

Pour une nouvelle langue, quelqu’un doit aussi l’ajouter à `LANGUAGES` et `FLAGS` dans `packages/i18n/src` (voir `docs/traductions.md`). `pnpm i18n:check` le rappelle tant que ce n’est pas fait.

## Règles

1. **Valeurs `{{…}}`** : les recopier à l’identique (même nom, accolades comprises), à la place naturelle dans la phrase. On peut en omettre une si la langue s’en passe, ou en utiliser une que le français omet seulement si elle apparaît dans l’anglais ; `pnpm i18n:check` refuse les autres.
2. **Pluriels** : une entrée avec `"plural": "one"`, `"few"`, `"many"`… est une forme de pluriel ; `{{count}}` est le nombre. Le kit demande toutes les formes de la langue cible, même celles que le français n’a pas.
3. **Clés** (`formatters.minAgo`) : ne jamais les modifier.
4. **Textes courts** (boutons, onglets, badges) : rester aussi court que l’original, l’écran est étroit sur téléphone.
5. **Majuscules** : respecter les textes écrits en capitales (surtitres comme `ALERTES DU DOMICILE`).
6. **Noms propres et marques** : garder Élise, Élise OS, Tailscale, Zigbee, Raspberry Pi, NodOn, SMLIGHT… tels quels. Les prénoms des données de démonstration (Jeanne, Claire, Luc, Sophie) restent aussi.
7. **Ton** : chaleureux, calme et précis. Vouvoiement ou forme polie de la langue. Jamais d’alarmisme, jamais de diagnostic : Élise relève des repères (« la porte est restée ouverte »), elle ne conclut pas (« elle est tombée »).
8. **Ponctuation** : celle de la langue cible (le français met une espace avant « : » et « ? », pas l’anglais).
9. **Unités et dates** : ne pas les écrire dans les textes ; l’app les met en forme selon la langue.
10. **Blocs `….copy.…`** : textes d’un écran entier ; traduire chaque ligne, la structure est reconstruite à l’import.

## À faire relire par une personne de langue maternelle

Les textes de sécurité doivent être exacts, sans ambiguïté :

- chutes (`fall`, `chute`), fumée (`smoke`), fuite d’eau (`waterLeak`), monoxyde de carbone (`carbonMonoxide`), bouton d’assistance (`assistanceButton`, `sos`) ;
- tout ce qui parle d’alerte urgente, d’appel ou de prise en charge (`alert`, `urgent`, `acknowledge`) ;
- la politique de confidentialité et l’accès à distance (`privacy`, `remoteAccess`).

Les signaler dans le compte rendu de traduction.

## Chaînes TV

Les noms de chaînes (ARTE, La 1, DW…) ne se traduisent pas. Les descriptions (`screenPanel.channelDescription.*`, `mobileScreenTabs.channelNote.*`) se traduisent comme les autres textes, en restant aussi courtes. Une nouvelle langue n’a pas besoin de ses propres chaînes : sans lignes dans le catalogue (voir « Chaînes TV » dans `docs/traductions.md`), l’écran reçoit les chaînes anglaises.

## Ce qui n’est pas dans ces fichiers

- La documentation de la landing (`eliselanding/src/content/docs/<langue>/`) : des pages Markdown à traduire telles quelles, en gardant les blocs de code et les liens.
- Les fiches App Store : `apps/mobile/fastlane/metadata/<langue>/` (description, mots-clés de 100 caractères au plus, sous-titre de 30 caractères au plus).
