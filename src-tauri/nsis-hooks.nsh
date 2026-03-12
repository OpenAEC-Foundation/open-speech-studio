!macro NSIS_HOOK_POSTINSTALL
  ; Copy WebView2Loader.dll next to the exe so the app can find it
  SetOutPath $INSTDIR
  File /a "C:\Users\rickd\Documents\GitHub\open-speech-studio\bin\WebView2Loader.dll"
  File /a "C:\Users\rickd\Documents\GitHub\open-speech-studio\bin\vcruntime140.dll"
  File /a "C:\Users\rickd\Documents\GitHub\open-speech-studio\bin\vcruntime140_1.dll"
  File /a "C:\Users\rickd\Documents\GitHub\open-speech-studio\bin\msvcp140.dll"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete "$INSTDIR\vcruntime140.dll"
  Delete "$INSTDIR\vcruntime140_1.dll"
  Delete "$INSTDIR\msvcp140.dll"
!macroend
