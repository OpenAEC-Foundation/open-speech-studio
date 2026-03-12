!macro NSIS_HOOK_POSTINSTALL
  ; Copy runtime DLLs next to the exe so the app can find them
  SetOutPath $INSTDIR
  ; These DLLs are bundled via tauri.conf.json resources ("../bin/*")
  ; and placed in the _up_/bin/ resource directory by Tauri.
  ; Copy them to $INSTDIR so Windows can locate them at runtime.
  IfFileExists "$INSTDIR\_up_\bin\WebView2Loader.dll" 0 +2
    CopyFiles /SILENT "$INSTDIR\_up_\bin\WebView2Loader.dll" "$INSTDIR\WebView2Loader.dll"
  IfFileExists "$INSTDIR\_up_\bin\vcruntime140.dll" 0 +2
    CopyFiles /SILENT "$INSTDIR\_up_\bin\vcruntime140.dll" "$INSTDIR\vcruntime140.dll"
  IfFileExists "$INSTDIR\_up_\bin\vcruntime140_1.dll" 0 +2
    CopyFiles /SILENT "$INSTDIR\_up_\bin\vcruntime140_1.dll" "$INSTDIR\vcruntime140_1.dll"
  IfFileExists "$INSTDIR\_up_\bin\msvcp140.dll" 0 +2
    CopyFiles /SILENT "$INSTDIR\_up_\bin\msvcp140.dll" "$INSTDIR\msvcp140.dll"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete "$INSTDIR\vcruntime140.dll"
  Delete "$INSTDIR\vcruntime140_1.dll"
  Delete "$INSTDIR\msvcp140.dll"
!macroend
