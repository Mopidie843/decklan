# DeckLan : liste des fonctions

État de la liste demandée « tout ce qu'il faut ajouter en priorité ». ✅ = fait et testé ici, 🟡 = fait mais non testable hors Windows/Android, ⛔ = non fait (raison donnée).

## Priorité 1 : fiabilité et sécurité
- ✅ Code PIN du téléphone, vérifié par le PC, haché, 5 essais puis 30 s de pause, reverrouillage à la veille.
- ✅ Confirmation avant les actions risquées (automatique pour éteindre, redémarrer, fermer la session ; réglable sur tout bouton).
- ✅ Sauvegarde automatique quotidienne de la configuration (7 jours).
- ✅ Journal des appuis et erreurs dans l'application.
- ✅ Validation stricte côté PC de toutes les nouvelles actions (URL http(s) seulement, liste fermée pour l'alimentation).
- ✅ Config retenue tant que le téléphone est verrouillé (rien d'envoyé avant le PIN).
- ⛔ HTTPS : un certificat auto-signé impose un avertissement sur le téléphone ; l'application Android (`android/`) règle le besoin principal (écran allumé).

## Priorité 2 : actions manquantes face à Elgato
- ✅ Requête web HTTP (GET/POST/PUT/DELETE, corps JSON) : domotique, webhooks, API locales.
- ✅ Alimentation : verrouiller, veille, hibernation, redémarrer, éteindre, fermer la session.
- ✅ Variables dans les textes et URL : `{date}` `{time}` `{datetime}` `{clipboard}`.
- ✅ Répétition d'un enchaînement (1 à 20 fois).
- ✅ Raccourci clavier global sur le PC pour lancer un bouton sans le téléphone 🟡 (Electron `globalShortcut`, Windows).
- ✅ Planning : un bouton à heure fixe, jours choisis.
- ✅ Chronomètre et minuteur sur le téléphone (vibration + bip en fin de minuteur).
- ✅ Nouveaux modèles : Alimentation, Domotique & web, Chrono, Minuteurs.

## Priorité 3 : confort
- ✅ Clic sonore optionnel.
- ✅ 7 nouvelles icônes (déconnexion, envoi, webhook, calendrier, prise, listes, journal).
- ✅ Application Android (WebView : écran toujours allumé, plein écran, scan QR) 🟡 non compilée ici.
- ✅ Workflow GitHub pour compiler l'APK, et script `scripts/build-apk.sh` sans Gradle (APK de 190 Ko construit et signé, non testé sur un téléphone).

## Priorité 4 : ajouts de la 2e passe (les points ⛔ de la liste précédente)
- ✅ HTTPS : certificat auto-signé créé et gardé dans le dossier de config (réglage « HTTPS »). Le téléphone affiche un avertissement la première fois. L'APK accepte ce certificat uniquement pour une adresse du réseau local.
- ✅ Plusieurs téléphones avec des profils différents (réglage « Profil propre à chaque téléphone ») : chacun garde son profil, retrouvé à la reconnexion (même adresse IP), tant que le PC tourne.
- ✅ Volume par application (spotify, chrome, discord…) : couper, réactiver, basculer, + / −, régler 🟡 (interface audio Windows, non testable ici).
- ✅ Média en cours (titre + artiste, toucher = lecture/pause) 🟡 (contrôles média Windows 10/11).
- ✅ Météo (Open-Meteo, sans clé, ville dans Réglages).
- ✅ Curseur de luminosité pour l'écran intégré d'un portable 🟡 (écrans externes non gérés par Windows via cette méthode).
- ✅ Action souris : clic, double-clic, clic droit, clic milieu, déplacement, molette, position fixe ou position du curseur, capture de position en 3 s 🟡.
- ✅ En-têtes HTTP (Authorization, etc.) et modèles Hue, Home Assistant, webhook Discord, ntfy (notification sur le téléphone), Shelly.
- ✅ Téléphone en anglais ou en français (réglage « Langue du téléphone »).
- ✅ Vérification des mises à jour via les releases GitHub (réglage « Mises à jour »), au démarrage et à la demande : ouvre la page de téléchargement.
- ✅ Molette type Stream Deck + : les curseurs volume et luminosité tiennent ce rôle sur le téléphone.

## Non fait, avec la raison
- ⛔ Synchroniser le muet Discord : Discord n'offre pas d'API locale utilisable sans créer et faire valider ta propre application Discord (OAuth). Le bouton Discord peut toujours envoyer le raccourci clavier ; seuls le micro/haut-parleurs Windows et OBS sont synchronisés.
- ⛔ Twitch, YouTube, Spotify (compte) en direct : chaque service exige une clé et une connexion OAuth. La requête HTTP avec en-têtes couvre les API qui acceptent un jeton collé à la main.
- ⛔ Enregistrer les clics souris pendant que tu les fais (macro) : demande un crochet global sur la souris ; l'action souris à position fixe couvre le besoin sans cela.
- ⛔ Interface de l'application PC en anglais : seul le téléphone est traduit.
- ⛔ Signature du .exe : demande un certificat de signature payant. Windows SmartScreen avertira donc au premier lancement.
- ⛔ Installation automatique des mises à jour : sans signature, elle n'est pas fiable. L'application te prévient et ouvre la page.
