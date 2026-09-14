# YGO Coach V6.1 — mise en ligne gratuite

La V6 utilise :

- **Supabase Free** : comptes + base PostgreSQL + synchronisation.
- **Cloudflare Pages** ou **GitHub Pages** : hébergement statique de l'application.
- Aucun serveur personnel n'est nécessaire.

## 1. Créer le projet Supabase

1. Crée un compte sur Supabase.
2. Crée un nouveau projet Free.
3. Dans **SQL Editor**, crée une nouvelle requête.
4. Copie-colle l'intégralité de `supabase-schema.sql`.
5. Exécute la requête.

Les tables suivantes seront créées :

- `ygo_matches`
- `ygo_tournaments`
- `ygo_profiles`

Les règles RLS garantissent que chaque utilisateur connecté ne voit que ses propres lignes.

## 2. Configurer l'application

Dans Supabase :

1. Ouvre les paramètres/API du projet.
2. Récupère :
   - le **Project URL**
   - la **Publishable key** (ou l'ancienne `anon public key`)

Ouvre `config.js` et renseigne :

```javascript
window.YGO_CONFIG = {
    supabaseUrl: "https://TON-PROJET.supabase.co",
    supabaseKey: "TA_CLE_PUBLISHABLE"
};
```

Ne mets JAMAIS une clé `service_role` dans le navigateur.

## 3. Authentification email

Dans Supabase > Authentication :

- Email/password doit être activé.
- Tu peux garder la confirmation d'email activée pour une vraie application publique.
- Pendant les premiers tests, tu peux aussi la désactiver pour créer ton compte immédiatement.

Quand l'application sera en ligne, ajoute son URL dans les URLs autorisées / Site URL de Supabase, par exemple :

`https://ygo-coach.pages.dev`

ou

`https://tonpseudo.github.io/ygo-coach/`

Cela est nécessaire pour les liens de confirmation et de récupération de mot de passe.

## 4. Tester en local

Lance Live Server exactement comme avant.

Ouvre l'application, puis :

**Plus > Synchronisation cloud**

Crée ton compte.

Lors de ta toute première connexion, la V6 détecte que ce navigateur contient déjà ta V5 et fusionne automatiquement :

- matchs
- G1/G2/G3
- side
- tournois
- profil

avec ton compte cloud.

## 5. Mettre l'app en ligne gratuitement

### Option simple : GitHub Pages

1. Crée un dépôt GitHub `ygo-coach`.
2. Envoie les fichiers de ce dossier dans le dépôt.
3. Dans GitHub : `Settings > Pages`.
4. Choisis `Deploy from a branch`.
5. Branche `main`, dossier `/ (root)`.
6. GitHub te donnera une URL HTTPS.

### Option : Cloudflare Pages

Tu peux également créer un projet Pages et connecter ton dépôt GitHub.
L'application est entièrement statique : pas de framework ni de commande de build nécessaire.

## 6. Sur l'iPhone

1. Ouvre l'URL HTTPS de l'app dans Safari.
2. Connecte-toi avec le même compte que sur le PC.
3. Safari > Partager > Ajouter à l'écran d'accueil.

Tes données se synchronisent ensuite automatiquement.

## Fonctionnement de la synchro

La V6 est **local-first** :

- chaque modification est enregistrée immédiatement dans `localStorage`;
- si Internet est disponible et que tu es connecté, elle est envoyée à Supabase;
- l'app vérifie le cloud au démarrage, au retour dans l'app et périodiquement;
- en cas de coupure réseau, la copie locale continue de fonctionner et les modifications sont envoyées au retour d'Internet.

Le premier login migre la base V5 locale vers le cloud.

## Fichiers

- `index.html`
- `style.css`
- `app.js`
- `config.js`
- `manifest.json`
- `sw.js`
- `supabase-schema.sql`
- `README.txt`
- `DEPLOYMENT.md`


## Mise à jour depuis la V6

Aucune modification de la base Supabase n'est nécessaire.

Dans le dossier du projet :

```powershell
git add .
git commit -m "YGO Coach V6.1"
git push
```

GitHub Pages redéploiera automatiquement la nouvelle version.

La V6.1 supprime la synchronisation périodique toutes les 30 secondes.
La synchronisation reste automatique lors des événements utiles.


## V6.2 — accès administrateur

Aucune modification Supabase n'est nécessaire.

Le compte administrateur configuré dans l'application est :

`felixlefevre170@gmail.com`

Les utilisateurs standards ne voient dans l'onglet Plus que :

- Mon coaching
- Mes événements

Pour déployer :

```powershell
git add .
git commit -m "YGO Coach V6.2 admin access"
git push
```


## V6.3 — profils, decks personnels et base adverse partagée

### 1. Migration Supabase

Dans **Supabase → SQL Editor**, exécuter le contenu de :

`supabase-v6.3-decks.sql`

Cette migration ajoute `public.ygo_opponent_decks` avec :

- lecture publique pour l'autocomplétion ;
- insertion uniquement pour un utilisateur authentifié ;
- unicité du nom normalisé pour éviter les doublons.

### 2. Déployer le frontend

```powershell
git add .
git commit -m "YGO Coach V6.3 decks and profiles"
git push
```

Aucune migration n'est nécessaire pour les decks personnels : ils sont stockés dans le JSON du profil existant.


## V6.4 — Deck Builder TCG, Side rapide et mains

Aucune nouvelle migration Supabase n'est nécessaire.

Les decklists sont stockées dans le JSON du profil existant et les mains
dans le JSON des matchs existants.

La base de cartes TCG est fournie par YGOPRODeck et mise en cache dans
IndexedDB sur chaque appareil.

Pour publier :

```powershell
git add .
git commit -m "YGO Coach V6.4 TCG deck builder"
git push
```

Le service worker utilise maintenant le cache `ygo-coach-v6-4`.
Les requêtes externes vers l'API de cartes ne sont pas stockées dans le
cache du service worker ; les cartes utiles sont conservées dans IndexedDB.


## V6.4.1 — Base de cartes FR / EN

Aucune migration Supabase n'est nécessaire.

Le choix de langue est enregistré dans le profil et les caches de cartes FR
et EN sont séparés dans IndexedDB.

Pour publier :

```powershell
git add .
git commit -m "YGO Coach V6.4.1 cartes FR EN"
git push
```

Le service worker utilise le cache `ygo-coach-v6-4-1`.


## V6.5 — Résumé des événements

Aucune migration Supabase n'est nécessaire.

Les résumés sont calculés directement depuis les matchs dont `tournamentId`
correspond au tournoi sélectionné.

Pour publier :

```powershell
git add .
git commit -m "YGO Coach V6.5 resumes tournois"
git push
```

Le service worker utilise maintenant le cache `ygo-coach-v6-5`.


## V6.5.1 — Refonte visuelle Yu-Gi-Oh

Aucune migration Supabase n'est nécessaire.
Pour publier :

```powershell
git add .
git commit -m "YGO Coach V6.5.1 theme yugioh"
git push
```

Le service worker utilise maintenant le cache `ygo-coach-v6-5-1`.


## V6.5.2 — Layout téléphone / TikTok

Aucune migration Supabase n'est nécessaire.

Pour publier :

```powershell
git add .
git commit -m "YGO Coach V6.5.2 format telephone"
git push
```

Le service worker utilise maintenant le cache `ygo-coach-v6-5-2`.
