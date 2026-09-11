YGO COACH V6.2

NOUVEAUTÉ PRINCIPALE
    - accès administrateur réservé au compte :
      felixlefevre170@gmail.com

ONGLET "PLUS"

Pour un utilisateur normal connecté, seuls ces blocs sont visibles :
    - Mon coaching
    - Mes événements

Les blocs suivants sont masqués :
    - Synchronisation cloud / panneau compte
    - Sauvegarde PC <-> iPhone
    - Import / export JSON
    - Réinitialisation

Pour le compte administrateur, tous les blocs restent disponibles.

CONNEXION / DÉCONNEXION
    - Si aucun compte n'est connecté, le bouton "Se connecter" reste visible en haut.
    - En cliquant dessus, l'utilisateur arrive sur le formulaire de connexion.
    - Pour un utilisateur normal déjà connecté, cliquer sur le bouton cloud du haut permet de se déconnecter sans faire apparaître les outils admin.

SÉCURITÉ
    - Les boutons admin sont masqués dans l'interface.
    - Les fonctions export/import/réinitialisation vérifient aussi l'adresse email du compte avant de s'exécuter.
    - Les règles RLS Supabase continuent de protéger les données entre utilisateurs.

IMPORTANT
Cette restriction admin est appliquée dans le frontend. Elle convient aux outils locaux de l'application.
Si de futures fonctions administrateur permettent de lire/modifier les données d'autres utilisateurs, il faudra alors ajouter un vrai rôle admin côté Supabase / serveur.

SUPABASE
    - aucune modification SQL nécessaire par rapport à la V6/V6.1
    - aucun changement de table
    - aucun changement de compte

MISE EN LIGNE

Après avoir remplacé les fichiers :

    git add .
    git commit -m "YGO Coach V6.2 admin access"
    git push

GitHub Pages redéploiera automatiquement.
