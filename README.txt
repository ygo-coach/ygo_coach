YGO COACH V6.5 - RÉSUMÉ DES ÉVÉNEMENTS

NOUVEAUTÉ PRINCIPALE

Dans Plus > Mes événements, chaque tournoi est maintenant cliquable.

Quand tu ouvres un tournoi, YGO Coach affiche un résumé complet :

    - résultat final du tournoi
    - winrate matchs
    - nombre de rondes
    - score global des games
    - winrate G1
    - winrate après side
    - winrate going first
    - winrate going second
    - ratio de dés gagnés
    - deck joué pendant l'événement
    - principal point à travailler
    - détail ronde par ronde
    - deck adverse de chaque ronde
    - score de chaque ronde
    - position G1 et résultat du dé
    - notes de match
    - récapitulatif des matchups affrontés

EXEMPLE

    WCQ Caen
    4-1
    80 % de winrate

    R1  Lunalight       Victoire 2-1
    R2  Mitsurugi      Victoire 2-0
    R3  K9             Défaite 1-2
    R4  Elfnote        Victoire 2-1
    R5  LADR           Victoire 2-0

Les statistiques sont calculées automatiquement depuis les matchs déjà liés
au tournoi. Il n'y a rien à saisir une deuxième fois.

FONCTIONNEMENT

Lors de la création d'une ronde, continue simplement à sélectionner le tournoi
dans le champ prévu.

YGO Coach relie alors le match au tournoi grâce à tournamentId.

Plus tard :

    Plus
    > Mes événements
    > cliquer sur le tournoi
    > résumé complet

AUCUNE MIGRATION SUPABASE

Aucune nouvelle table SQL n'est nécessaire.

La V6.5 utilise uniquement les données déjà présentes dans :
    ygo_matches
    ygo_tournaments

La synchronisation PC / iPhone continue donc de fonctionner normalement.

TOUTES LES FONCTIONNALITÉS PRÉCÉDENTES RESTENT PRÉSENTES

    - comptes Supabase
    - synchronisation cloud optimisée
    - compte administrateur
    - Profil
    - Mes decks
    - Deck Builder TCG FR / EN
    - Main / Extra / Side
    - mains de départ
    - Side rapide
    - coach
    - base communautaire de decks adverses

DÉPLOIEMENT

Remplace les fichiers du projet puis :

    git add .
    git commit -m "YGO Coach V6.5 resumes tournois"
    git push

GitHub Pages redéploiera automatiquement.

Si l'ancienne version reste affichée :
    PC : Ctrl + F5
    iPhone : fermer complètement la PWA puis la rouvrir


V6.5.1 — THÈME VISUEL YU-GI-OH MODERNE

Cette version retravaille surtout le style visuel :
    - palette sombre violet / bleu nuit / or
    - ambiance plus "duel" et moins "site de banque"
    - cartes et panneaux en verre sombre
    - boutons plus flashy
    - navigation basse plus immersive
    - résumé de tournoi restylé

Aucune migration Supabase n'est nécessaire.


V6.5.3 — RÉSUMÉ AU FORMAT TÉLÉPHONE UNIQUEMENT

L'application reste responsive normalement sur PC.

Seul le résumé d'événement est forcé dans un cadre téléphone :
    - environ 390 px de large sur PC
    - centré à l'écran
    - plein écran sur téléphone
    - format pensé pour capture / TikTok / Shorts
    - contenu compacté sur un seul écran

La barre de navigation principale est aussi forcée en position fixed
pour rester au bas du viewport.

Aucune migration Supabase n'est nécessaire.
