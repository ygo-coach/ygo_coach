YGO COACH V6.4 - TCG DECK BUILDER + MAINS DE DÉPART

NOUVEAUTÉS

1. Deck Builder TCG
    - Profil > Mes decks > Construire
    - Main Deck : 40 à 60 cartes
    - Extra Deck : 0 à 15 cartes
    - Side Deck : 0 à 15 cartes
    - recherche dans la base de cartes TCG YGOPRODeck
    - banlist TCG prise en compte
    - cartes interdites bloquées
    - limites 1 / 2 / 3 exemplaires contrôlées sur l'ensemble Main + Extra + Side
    - Fusion / Synchro / Xyz / Link dirigés vers l'Extra Deck
    - Tokens / Skill Cards exclus du constructeur standard

2. Cache local de cartes
    - la base TCG est téléchargée à la première recherche
    - seules les informations utiles sont conservées
    - stockage dans IndexedDB
    - cache valable 7 jours
    - bouton "Mettre à jour" pour forcer la dernière version
    - aucune image de carte n'est chargée automatiquement

3. Side rapide pendant un duel
    - G2 et G3 affichent les cartes du Side Deck
    - un clic sélectionne les cartes à rentrer
    - les cartes du Main / Extra sont proposées pour les sorties
    - plusieurs exemplaires peuvent être sélectionnés
    - les champs texte restent disponibles en secours

4. Mains de départ
    - G1 / G2 / G3 : sélection par clic des cartes réellement piochées
    - maximum 5 cartes
    - la main est enregistrée avec la game
    - elle apparaît dans l'historique

5. Coaching sur les mains
    - à partir d'au moins 5 games renseignées en going first,
      le coach commence à exploiter les mains
    - une carte doit apparaître dans au moins 3 games pour être utilisée
      dans l'insight affiché
    - le coach peut alors indiquer les cartes de main associées aux
      meilleurs résultats observés en commençant

SYNCHRONISATION

Les vraies decklists sont enregistrées dans le profil existant :
    profile.decks[].mainDeck
    profile.decks[].extraDeck
    profile.decks[].sideDeck

Elles bénéficient donc de la synchronisation Supabase déjà existante.
Aucune nouvelle table Supabase n'est nécessaire pour la V6.4.

Les mains de départ sont enregistrées directement dans les games de match
et utilisent la table ygo_matches existante.

BASE DE DECKS ADVERSES

La fonctionnalité V6.3 reste présente.
Si tu n'as pas encore créé la table communautaire, exécute :
    supabase-v6.3-decks.sql

Si elle fonctionne déjà, ne relance rien.

BASE DE CARTES

Source :
    YGOPRODeck API v7
    https://db.ygoprodeck.com/api/v7/cardinfo.php?format=tcg

YGO Coach utilise les noms anglais des cartes pour garder les noms TCG
canoniques et ne hotlink pas les images.

CONFIG SUPABASE

Le config.js fourni contient déjà la configuration publishable du projet.
Ne jamais remplacer cette clé par service_role ou sb_secret_...

MISE EN LIGNE

Remplace les fichiers de ton projet par ceux de ce dossier puis :

    git add .
    git commit -m "YGO Coach V6.4 TCG deck builder"
    git push

GitHub Pages redéploiera automatiquement.

Si l'ancienne version reste affichée :
    PC : Ctrl + F5
    iPhone : ferme complètement la PWA puis rouvre-la.

IMPORTANT

Les règles principales de construction sont contrôlées, mais YGO Coach
n'est pas encore un validateur Konami exhaustif pour tous les cas spéciaux
de texte de carte ("treated as", règles particulières, etc.).
