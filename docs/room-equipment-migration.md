# Fiche d’équipement des pièces

La migration `20260910100000_retire_room_furniture` sauvegarde les plans contenant du mobilier dans `HomePlanFurnitureBackup`, puis retire leurs meubles. Les pièces, ouvertures, escaliers, appareils et rôles restent conservés. Les associations à un meuble deviennent des associations à la pièce, accompagnées d’un emplacement textuel. Les notes existantes ont priorité dans la limite de 500 caractères.

La sauvegarde contient le JSON complet, sa révision et les notes originales des appareils. Elle est créée une seule fois, sans suppression en cascade. La migration est transactionnelle et peut être rejouée sans changer un plan déjà converti. Elle est appliquée par le parcours habituel `prisma migrate deploy`, avant de démarrer l’API mise à jour.

## Restauration ciblée

Arrêter temporairement les écritures et utiliser une version de l’application qui prend en charge le mobilier. Identifier le logement et son instantané dans `HomePlanFurnitureBackup`. Dans une transaction, remettre `planData` dans le plan correspondant, avec une révision supérieure à la révision courante (colonne et JSON), puis restaurer uniquement les notes nécessaires depuis `deviceNotes`. Une restauration du JSON complet remplace les modifications intervenues depuis la migration : comparer les deux versions avant restauration. Conserver l’instantané après l’opération. Aucune restauration automatique n’est lancée.

## Produits

La sélection et ses sources sont définies dans `sensor-products.ts`. Les photos proviennent des fiches Zigbee2MQTT vérifiées. Une intégration documentée ne constitue pas un test matériel avec Élise. Aucun modèle de chute ni modèle extérieur n’est déclaré compatible sans preuve ; ces catégories restent accessibles à la détection automatique et aux appareils reconnus.

Les valeurs de la fiche indiquent la dernière réception. Après une heure sans réception, ou quand l’appareil n’est plus joignable, elles sont présentées comme anciennes. La configuration reste distincte de la disponibilité et du résultat du test.
