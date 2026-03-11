@echo off
setlocal enabledelayedexpansion

:: Build a new PATH excluding Git\usr\bin (contains conflicting link.exe)
set "NEWPATH="
set "OLDPATH=%PATH%"

:loop
for /f "tokens=1* delims=;" %%a in ("!OLDPATH!") do (
    set "SEGMENT=%%a"
    echo !SEGMENT! | findstr /i "Git\\usr\\bin" >nul 2>nul
    if errorlevel 1 (
        if defined NEWPATH (
            set "NEWPATH=!NEWPATH!;!SEGMENT!"
        ) else (
            set "NEWPATH=!SEGMENT!"
        )
    ) else (
        echo Excluding from PATH: !SEGMENT!
    )
    set "OLDPATH=%%b"
    if defined OLDPATH goto :loop
)

set "PATH=!NEWPATH!"
set "LIBCLANG_PATH=C:\Program Files\LLVM\bin"

echo === Open Speech Studio Build ===
echo.
where link.exe 2>nul || echo No link.exe found (OK if no MSVC)
echo.

cd /d "%~dp0"

echo [1/2] Frontend build...
call npm run build
if errorlevel 1 (
    echo FRONTEND BUILD FAILED
    exit /b 1
)

echo.
echo [2/2] Rust + Tauri build...
call npx tauri build
if errorlevel 1 (
    echo TAURI BUILD FAILED
    exit /b 1
)

echo.
echo === BUILD COMPLETE ===
dir /b /s src-tauri\target\release\bundle\*.exe 2>nul
dir /b /s src-tauri\target\release\bundle\*.msi 2>nul
