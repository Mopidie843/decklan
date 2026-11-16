# DeckLan

Utilise ton téléphone Android comme un Stream Deck pour ton PC Windows, via le réseau local (Wi-Fi).

- **PC** : application Electron (éditeur de boutons + serveur intégré, vit dans la zone de notification).
- **Téléphone** : page web servie par le PC (scan d'un QR code), ou la petite application Android du dossier `android/`.

## Lancer

    npm install
    npm start

Tests : `npm test`.

## Fichiers prêts à l'emploi

- `DeckLan-portable.exe` : un seul .exe pour Windows 64 bits, sans installation (il s'extrait au lancement). Non signé : Windows SmartScreen affiche un avertissement, choisis « Informations complémentaires » puis « Exécuter quand même ».
- `DeckLan.apk` : application Android (Android 5.0 et plus), signée avec une clé de test locale. Autorise l'installation depuis des sources inconnues.

## Reconstruire

- .exe : `npm install` puis `npm run dist` (résultat dans `dist/`). Sur Linux, l'installeur NSIS demande Wine ; la version portable n'en a pas besoin. `npm run dist:setup` crée l'installeur sur Windows.
- APK sans Gradle : `bash scripts/build-apk.sh /chemin/android.jar dist/DeckLan.apk` (outils : aapt2, javac, dx, zipalign, apksigner ; `android.jar` de l'API 34).
- APK avec Android Studio : ouvre le dossier `android/`, ou lance le workflow GitHub « Android APK ».

## Application Android

Coque WebView : écran toujours allumé, plein écran, mémorisation de la dernière adresse, aucune dépendance Google.
Appairage : dans DeckLan (onglet Connexion), choisis « Application DeckLan » et scanne le QR code avec l'appareil photo : il ouvre l'app et la connecte. Sinon, copie le lien et utilise « Coller le lien copié ».
L'APK accepte le certificat HTTPS auto-signé uniquement pour une adresse du réseau local.

## Utiliser

1. Ouvre DeckLan sur le PC, onglet **Connexion**, scanne le QR code avec le téléphone (même Wi-Fi).
2. Au premier lancement, autorise DeckLan dans le pare-feu Windows (réseau privé).
3. Édite tes boutons dans **Éditeur** : les changements arrivent en direct sur le téléphone.

## Fonctions

Le détail, y compris ce qui n'est pas fait, est dans [FEATURES.md](FEATURES.md).

- **Actions** : raccourcis (avec enregistreur), texte (variables `{date}` `{time}` `{datetime}` `{clipboard}`), ouvrir appli/fichier/lien, commande Windows,
  touches média, micro / haut-parleurs, volume par application, souris (clic, déplacement, molette), OBS (scènes, enregistrement, direct, sources), Wake-on-LAN, requête web HTTP avec en-têtes (domotique, webhooks),
  alimentation (verrouiller, veille, hibernation, redémarrer, éteindre, fermer la session), enchaînements avec pauses et répétitions, enregistreur de macro clavier.
- **Boutons** : appui long, répétition à l'appui maintenu, bascule à 2 états (liée à l'état réel du micro, du son ou d'OBS), largeur 1 à 4 cases,
  confirmation avant exécution, raccourci clavier global sur le PC, images, icônes intégrées (lucide) ou emojis.
- **Widgets** : heure, date, CPU, RAM, météo, média en cours, curseurs de volume et de luminosité, chronomètre, minuteur.
- **Organisation** : pages, dossiers, profils multiples (import/export), page liée à une appli au premier plan, modèles, annuler/rétablir, copier/coller.
- **Planning** : lance un bouton à heure fixe, certains jours.
- **Journal** : derniers appuis et erreurs.
- **Téléphone** : veille avec horloge, code PIN (vérifié par le PC), clic sonore, vibration, français ou anglais, profil propre à chaque téléphone (option).
- **Réseau** : HTTPS facultatif (certificat auto-signé), vérification des mises à jour GitHub, adresse fixe `decklan.local` (mDNS), mode sans fenêtre (`npm run headless`) pour une machine toujours allumée (nécessaire pour réveiller un PC éteint).
- **Sauvegardes** : une copie automatique par jour (7 gardées) dans le dossier `backups` de la config.

## Sécurité

Le téléphone n'envoie que l'identifiant d'un bouton ; l'action est relue dans la config du PC. Un code secret (dans le QR) est requis,
régénérable à tout moment. Un code PIN facultatif verrouille en plus les boutons (5 essais, puis 30 s de pause).
Le serveur écoute sur le réseau local (HTTP, ou HTTPS auto-signé si activé) : ne l'expose pas sur Internet.
Le mot de passe OBS est stocké en clair dans `config.json` (dossier de données de l'application). Le PIN, lui, est haché.
Les requêtes HTTP sont envoyées par le PC vers l'adresse que tu as saisie : ne colle pas de configuration importée d'une source inconnue sans la relire.

## Mémoire

Fermer la fenêtre la détruit (le serveur continue dans la zone de notification). PowerShell n'est lancé que pendant qu'un téléphone est connecté.
