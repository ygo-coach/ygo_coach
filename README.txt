YGO COACH V6.4.1 - BASE DE CARTES FR / EN

Cette version part de la V6.4 et conserve :
    - Deck Builder TCG
    - Main / Extra / Side Deck
    - Side rapide
    - mains de départ
    - coaching basé sur les mains
    - base communautaire de decks adverses
    - synchronisation Supabase
    - accès administrateur

NOUVEAUTÉ V6.4.1

Dans Profil > Préférences cartes :

    Français
    English

Le choix est enregistré dans le profil et se synchronise entre les appareils.

FRANÇAIS

La base YGOPRODeck est chargée avec :

    https://db.ygoprodeck.com/api/v7/cardinfo.php?format=tcg&language=fr

Les recherches et le Deck Builder utilisent alors les noms français disponibles
dans la base YGOPRODeck.

ANGLAIS

La base utilise :

    https://db.ygoprodeck.com/api/v7/cardinfo.php?format=tcg

COMPATIBILITÉ DES DECKLISTS

Les cartes de tes decks sont reconnues grâce à leur ID YGOPRODeck.

Cela permet de passer de :

    Ash Blossom & Joyous Spring

à son nom français disponible dans la base, sans supprimer la carte de la decklist.

Quand une langue est chargée, YGO Coach actualise les noms des cartes déjà
présentes dans Main / Extra / Side à partir de leur ID.

CACHE

Chaque langue possède son propre cache IndexedDB :

    ygoCoachCardDatabase-fr
    ygoCoachCardDatabase-en

Le cache reste valable 7 jours.

Le bouton "Mettre à jour" force une actualisation de la langue actuellement
sélectionnée.

AUCUNE MIGRATION SUPABASE

Aucune nouvelle table ou requête SQL n'est nécessaire.

Le choix de langue est enregistré dans :

    profile.cardLanguage

Les decklists restent dans :

    profile.decks[].mainDeck
    profile.decks[].extraDeck
    profile.decks[].sideDeck

CONFIG.JS

La configuration publishable Supabase du projet est déjà présente.

Ne jamais mettre une clé service_role ou sb_secret_... dans config.js.

DÉPLOIEMENT

Remplace les fichiers de ton projet puis :

    git add .
    git commit -m "YGO Coach V6.4.1 cartes FR EN"
    git push

Si le navigateur garde l'ancienne version :

    PC : Ctrl + F5
    iPhone : fermer complètement la PWA puis la rouvrir
