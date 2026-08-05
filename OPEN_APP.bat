@echo off
title GenGal Automatic Launcher
cd /d "%~dp0"

echo Launching GenGal Intelligent Auto-Server...
powershell -ExecutionPolicy Bypass -File .\scripts\auto-launcher.ps1
pause
