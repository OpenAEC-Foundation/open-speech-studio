@echo off
echo ============================================
echo  Visual C++ Build Tools installeren
echo  (dit vereist Administrator-rechten)
echo ============================================
echo.
echo Dit installeert alleen de C++ compiler en linker.
echo Geen volledige Visual Studio nodig.
echo.

"C:\Program Files (x86)\Microsoft Visual Studio\Installer\vs_installer.exe" modify ^
    --installPath "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools" ^
    --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 ^
    --add Microsoft.VisualStudio.Component.Windows11SDK.26100 ^
    --quiet --norestart --wait

if %errorlevel% equ 0 (
    echo.
    echo [OK] Visual C++ Tools geinstalleerd!
    echo.
    echo Voer nu uit: build.bat
) else (
    echo.
    echo Foutcode: %errorlevel%
    echo Probeer handmatig: Visual Studio Installer openen en C++ toevoegen
)
pause
