@echo off
title SafeQR Backend - Push to GitHub
echo ========================================================
echo   SafeQR Cloud Backend - Push to GitHub Utility
echo ========================================================
echo.
set /p REPO_URL="Enter your GitHub Repository URL (e.g. https://github.com/Username/safeqr-backend.git): "
if "%REPO_URL%"=="" (
    echo [ERROR] Repository URL cannot be empty!
    pause
    exit /b 1
)
echo.
echo [1/3] Setting remote origin...
"%~dp0..\tools\git\cmd\git.exe" remote remove origin 2>nul
"%~dp0..\tools\git\cmd\git.exe" remote add origin %REPO_URL%

echo [2/3] Setting branch to main...
"%~dp0..\tools\git\cmd\git.exe" branch -M main

echo [3/3] Pushing code to GitHub...
"%~dp0..\tools\git\cmd\git.exe" push -u origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo  [SUCCESS] Code successfully pushed to GitHub!
    echo  Ab aap Render.com ya Railway.app par 1-click deploy
    echo  karke 24/7 live kar sakte hain!
    echo ========================================================
) else (
    echo.
    echo [ERROR] Push failed. Make sure your GitHub repository exists
    echo and you are signed in.
)
echo.
pause
