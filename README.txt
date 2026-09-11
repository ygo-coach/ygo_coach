YGO COACH V6 CLOUD

NOUVEAUTÉS
    - création de compte email / mot de passe
    - connexion / déconnexion
    - récupération de mot de passe
    - synchronisation automatique PC <-> iPhone
    - migration automatique de la base V5 au premier login
    - fonctionnement local-first
    - copie locale disponible même si le cloud est momentanément inaccessible
    - synchronisation manuelle "Synchroniser maintenant"
    - synchronisation périodique quand l'app est ouverte
    - protection des données avec Supabase RLS
    - suppression cloud lors de la réinitialisation si l'utilisateur est connecté

GRATUIT
    - le code fonctionne avec le plan Free de Supabase
    - l'application peut être hébergée gratuitement sur GitHub Pages ou Cloudflare Pages

IMPORTANT
    1. Exécute `supabase-schema.sql` dans Supabase SQL Editor.
    2. Renseigne `config.js` avec le Project URL et la publishable key.
    3. N'utilise JAMAIS la clé service_role côté navigateur.
    4. Lis DEPLOYMENT.md pour la mise en ligne.

BASE V5 CONSERVÉE
Les clés locales principales ne changent pas :
    ygoCoachMatches
    ygoCoachTournaments
    ygoCoachProfile

Au premier login sur ce navigateur, les données existantes sont fusionnées dans le compte cloud.
