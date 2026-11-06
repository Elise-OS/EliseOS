# Logos de tiers

Les logos des chaînes de télévision ne font pas partie d’Élise OS et ne sont pas couverts par sa licence (AGPL-3.0-only). Ce sont des **marques de leurs propriétaires respectifs**. Élise OS les affiche uniquement pour désigner la chaîne que l’on regarde ou choisit (usage nominatif) ; cela n’implique ni partenariat ni approbation de ces chaînes.

Ils sont embarqués dans le dépôt (aucun chargement depuis Internet) :

- `apps/dashboard/public/tv-logos/<logo>.svg` : espace aidant, écran TV et démo publique ;
- `apps/mobile/assets/tv-logos/<logo>.png` : application mobile (rendu du même SVG).

Les fichiers proviennent de Wikimedia Commons (consultés le 6 novembre 2026). Ils ont été nettoyés (métadonnées et attributs d’éditeur retirés, cadrage resserré) et optimisés avec svgo, sans changer le dessin.

| Fichier `<logo>`     | Chaîne(s)                            | Source                                                                                                         | Statut indiqué sur Commons                   | Version                              |
| -------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------ |
| `arte`               | ARTE                                 | [File:Arte_Logo_2026.svg](https://commons.wikimedia.org/wiki/File:Arte_Logo_2026.svg)                          | domaine public (PD-textlogo), marque déposée | logo de 2011, fichier redessiné 2026 |
| `rmc-life`           | RMC Life                             | [File:RMC_Life_logo_2025.svg](https://commons.wikimedia.org/wiki/File:RMC_Life_logo_2025.svg)                  | domaine public (PD-textlogo), marque déposée | depuis le 1er octobre 2025           |
| `rmc-story`          | RMC Story                            | [File:RMC_Story_2025.svg](https://commons.wikimedia.org/wiki/File:RMC_Story_2025.svg)                          | domaine public (PD-textlogo), marque déposée | depuis le 17 décembre 2025           |
| `rmc-decouverte`     | RMC Découverte                       | [File:RMC_Découverte_logo_2025.svg](https://commons.wikimedia.org/wiki/File:RMC_D%C3%A9couverte_logo_2025.svg) | domaine public (PD-textlogo)                 | depuis le 17 décembre 2025           |
| `la1`                | La 1 (RTVE)                          | [File:La_1_2026.svg](https://commons.wikimedia.org/wiki/File:La_1_2026.svg)                                    | domaine public (PD-textlogo), marque déposée | depuis 2026                          |
| `la2`                | La 2 (RTVE)                          | [File:La_2_2026.svg](https://commons.wikimedia.org/wiki/File:La_2_2026.svg)                                    | domaine public (PD-textlogo), marque déposée | depuis 2026                          |
| `24h`                | 24h – Canal 24 Horas (RTVE)          | [File:24h_2026.svg](https://commons.wikimedia.org/wiki/File:24h_2026.svg)                                      | domaine public (PD-textlogo), marque déposée | depuis 2026                          |
| `clan`               | Clan (RTVE)                          | [File:Clan_2026.svg](https://commons.wikimedia.org/wiki/File:Clan_2026.svg)                                    | domaine public (PD-textlogo), marque déposée | depuis 2026                          |
| `france24`           | France 24 Español, France 24 English | [File:France_24_logo_(2013).svg](<https://commons.wikimedia.org/wiki/File:France_24_logo_(2013).svg>)          | domaine public (PD-textlogo), marque déposée | depuis 2013                          |
| `dw`                 | DW Español, DW English               | [File:Deutsche_Welle_symbol_2012.svg](https://commons.wikimedia.org/wiki/File:Deutsche_Welle_symbol_2012.svg)  | domaine public (PD-textlogo), marque déposée | depuis 2012                          |
| `al-jazeera-english` | Al Jazeera English                   | [File:Aljazeera_eng.svg](https://commons.wikimedia.org/wiki/File:Aljazeera_eng.svg)                            | domaine public (PD-textlogo, PD-shape)       | logo actuel (fichier revu en 2025)   |

« Domaine public » porte ici sur le droit d’auteur (logo trop simple pour être protégé) ; le droit des marques s’applique toujours. Si un titulaire souhaite que son logo soit retiré, l’application revient au badge texte de la chaîne (`badge` dans `packages/contracts/src/tv-channels.ts`).
