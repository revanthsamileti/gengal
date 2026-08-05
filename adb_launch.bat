@echo off
echo ==========================================
echo        GenGal ADB Device Launcher
echo ==========================================
echo.

set ADB="%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
set DEVICE_ID=a3527f67

echo [1/3] Setting up port forwarding...
%ADB% -s %DEVICE_ID% reverse tcp:8081 tcp:8081
%ADB% -s %DEVICE_ID% reverse tcp:5000 tcp:5000

echo.
echo [2/3] Launching GenGal on your phone...
%ADB% -s %DEVICE_ID% shell am start -n com.revanth_fk.x.GenGal/.MainActivity -a android.intent.action.VIEW -d "exp://127.0.0.1:8081"

echo.
echo [3/3] Done! Make sure your Expo server and Python backend are running.
echo.
pause
