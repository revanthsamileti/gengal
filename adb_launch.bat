@echo off
setlocal enabledelayedexpansion
echo ==========================================
echo        GenGal ADB Device Launcher
echo ==========================================
echo.

REM Resolve adb instead of assuming one SDK location. The previous hardcoded
REM %LOCALAPPDATA% path does not exist on every machine, and the failure was
REM silent: no tunnels, no launch, no error worth reading.
set "ADB="
for %%A in (adb.exe) do if not "%%~$PATH:A"=="" set "ADB=%%~$PATH:A"
if not defined ADB if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
if not defined ADB if exist "C:\Android\sdk\platform-tools\adb.exe" set "ADB=C:\Android\sdk\platform-tools\adb.exe"
if not defined ADB if exist "%ProgramFiles%\Android\platform-tools\adb.exe" set "ADB=%ProgramFiles%\Android\platform-tools\adb.exe"

if not defined ADB (
    echo ERROR: adb not found. Install platform-tools or add adb to PATH.
    exit /b 1
)

REM Must match the port in EXPO_PUBLIC_BACKEND_URL (.env). This used to forward
REM 5000, which no longer matches the backend, so the app could reach the
REM packager but not the API -- every call died at RTC token prefetch.
set BACKEND_PORT=5055

echo [1/3] Forwarding ports on every connected device...
REM Loops over all devices rather than the one hardcoded serial this used to
REM carry: a call test needs two handsets, and the un-tunnelled one simply
REM never rings.
set FOUND=0
for /f "skip=1 tokens=1,2" %%a in ('"%ADB%" devices') do (
    if "%%b"=="device" (
        set FOUND=1
        "%ADB%" -s %%a reverse tcp:8081 tcp:8081 >nul
        "%ADB%" -s %%a reverse tcp:%BACKEND_PORT% tcp:%BACKEND_PORT% >nul
        echo     %%a : 8081 + %BACKEND_PORT% forwarded
    )
)

if "!FOUND!"=="0" (
    echo     No devices found. Plug in USB and enable USB debugging.
    exit /b 1
)

echo.
echo [2/3] Launching GenGal on every connected device...
for /f "skip=1 tokens=1,2" %%a in ('"%ADB%" devices') do (
    if "%%b"=="device" (
        "%ADB%" -s %%a shell am start -n com.revanth_fk.x.GenGal/.MainActivity -a android.intent.action.VIEW -d "exp://127.0.0.1:8081" >nul
        echo     launched on %%a
    )
)

echo.
echo [3/3] Done. Metro and the Python backend must both be running.
echo      Tunnels drop when a phone sleeps or is replugged - re-run this if calls stop connecting.
echo.
endlocal
