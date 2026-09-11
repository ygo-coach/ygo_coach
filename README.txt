YGO COACH V6.3 - PROFILS & BIBLIOTHÈQUES DE DECKS

NOUVEAUTÉS

    - nouvelle page Profil dans la navigation
    - bibliothèque personnelle "Mes decks"
    - possibilité de choisir un deck actif / par défaut
    - pendant l'ajout d'un match, tous les decks personnels apparaissent sous forme de boutons
    - un clic sur un deck remplit immédiatement "Mon deck"
    - base Supabase commune de decks adverses
    - autocomplétion du deck adverse pendant la saisie
    - un utilisateur connecté peut proposer un nouveau deck adverse
    - les nouveaux decks adverses deviennent disponibles pour tous
    - cache local de la base adverse pendant 6 heures pour limiter les requêtes Supabase

IMPORTANT : MIGRATION SUPABASE OBLIGATOIRE

Avant d'utiliser la base partagée, ouvre Supabase > SQL Editor et exécute :

    supabase-v6.3-decks.sql

Le script crée uniquement la nouvelle table ygo_opponent_decks et ses règles RLS.
Il ne supprime ni ne modifie les matchs/tournois/profils déjà présents.

MES DECKS

Les decks personnels sont stockés dans le profil existant, donc ils profitent déjà de la synchronisation cloud V6.
Le champ historique profile.deck est conservé pour la compatibilité avec les anciennes versions.

BASE ADVERSE PARTAGÉE

    - lecture : accessible à tous pour afficher les suggestions
    - ajout : réservé aux utilisateurs connectés
    - pas de modification/suppression publique
    - les doublons de noms sont bloqués côté PostgreSQL

MISE À JOUR GITHUB PAGES

Après avoir remplacé les fichiers de ton projet :

    git add .
    git commit -m "YGO Coach V6.3 decks and profiles"
    git push

GitHub Pages redéploiera automatiquement.

Si l'ancienne interface reste visible :

    PC : Ctrl + F5
    iPhone/PWA : fermer complètement l'app puis la rouvrir
