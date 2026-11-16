; Textes de l'assistant d'installation DeckLan (français).
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Bienvenue dans DeckLan"
  !define MUI_WELCOMEPAGE_TEXT "DeckLan transforme ton téléphone Android en Stream Deck pour ton PC, via le Wi-Fi.$\r$\n$\r$\nL'installation télécharge l'application (environ 70 Mo) : garde ta connexion internet active.$\r$\n$\r$\nClique sur Suivant pour continuer."
  !insertmacro MUI_PAGE_WELCOME
!macroend
!macro customInstall
!macroend
; Installation pour l'utilisateur courant uniquement : pas de page « tous les utilisateurs / moi seulement ».
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
