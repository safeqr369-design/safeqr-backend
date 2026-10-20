@echo off
title SafeQR Backend - Push to GitHub
echo ========================================================
echo   SafeQR Cloud Backend - Push to GitHub
echo ========================================================
echo.
set "PATH=%~dp0..\tools\git\cmd;%~dp0..\tools\git\mingw64\bin;%PATH%"
set "REPO_URL=https://github.com/safeqr369-design/safeqr-backend.git"

echo Target Repository: %REPO_URL%
echo.
echo [1/3] Setting remote origin...
git remote remove origin 2>nul
git remote add origin %REPO_URL%

echo [2/3] Setting branch to main...
git branch -M main

echo [3/3] Pushing code to GitHub...
echo (Agar browser window khule, toh "Sign in with browser" par click karke authorize karein)
echo.
git push -u origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo  [SUCCESS] Code successfully pushed to GitHub!
    echo  Repository: https://github.com/safeqr369-design/safeqr-backend
    echo  Ab aap Render.com par 1-click deploy kar sakte hain!
    echo ========================================================
) else (
    echo.
    echo [ERROR] Push failed.
    echo Agar Personal Access Token (PAT) use karna chahein,
    echo https://github.com/settings/tokens se token generate karein.
)
echo.
pause
