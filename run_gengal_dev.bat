@echo off
title GenGal Developer Launcher
cd /d "%~dp0"

echo ===================================================
echo         GenGal Dev Environment Launcher            
echo ===================================================
echo.

echo [1/3] Starting Backend Server and Cloudflare Tunnel...
powershell -ExecutionPolicy Bypass -File .\scripts\start-remote-debug.ps1
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Backend or Tunnel startup failed!
    pause
    exit /b %errorlevel%
)

echo.
echo [2/3] Setting up ADB USB port reverse for connected devices...
set ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe
powershell -ExecutionPolicy Bypass -Command "& '%ADB%' devices | Select-String '\bdevice\b' | ForEach-Object { $id = $_.Line.Split([char]9)[0].Trim(); Write-Host ('Setting adb reverse tcp:8081 tcp:8081 for ' + $id); & '%ADB%' -s $id reverse tcp:8081 tcp:8081 2>$null }"
echo.
echo Connected devices:
"%ADB%" devices

echo.
echo [3/3] Launching Expo Metro Server...
echo       (USB tunnel active - devices on any network will work)
echo.

start "" powershell -ExecutionPolicy Bypass -Command ^
    "while($true){ Start-Sleep 10; $adb='%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe'; & $adb devices | Select-String '\bdevice\b' | ForEach-Object { $id = $_.Line.Split([char]9)[0].Trim(); & $adb -s $id reverse tcp:8081 tcp:8081 2>$null } }"

npx expo start --tunnel --clear
pause
