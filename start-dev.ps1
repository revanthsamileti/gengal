# GenGal Development Launcher
# Usage: .\start-dev.ps1 [-Mode lan|usb|tunnel]
# Defaults to USB mode (most reliable with adb reverse)

param(
    [ValidateSet("usb", "lan", "tunnel")]
    [string]$Mode = "usb"
)

$ErrorActionPreference = "Continue"
$ADB = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"

Write-Host ""
Write-Host "  GenGal Development Server" -ForegroundColor Magenta
Write-Host "  ========================" -ForegroundColor DarkGray
Write-Host ""

# --- Detect LAN IP ---
$lanIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.InterfaceAlias -match "Wi-Fi|Ethernet" -and $_.IPAddress -notlike "169.*"
} | Select-Object -First 1).IPAddress

if (-not $lanIP) { $lanIP = "127.0.0.1" }

# --- Mode-specific setup ---
switch ($Mode) {
    "usb" {
        Write-Host "  Mode: USB (adb reverse)" -ForegroundColor Cyan
        $env:REACT_NATIVE_PACKAGER_HOSTNAME = "127.0.0.1"
        
        # Find connected device
        $devices = & $ADB devices 2>$null | Select-String "device$"
        if ($devices) {
            $serial = ($devices[0].Line -split "\s+")[0]
            Write-Host "  Device: $serial" -ForegroundColor Green
            $env:ANDROID_SERIAL = $serial
            
            # Set up reverse port forwarding
            & $ADB -s $serial reverse tcp:8081 tcp:8081 2>$null
            Write-Host "  adb reverse: tcp:8081 -> tcp:8081" -ForegroundColor Green
        } else {
            Write-Host "  WARNING: No device connected. Plug in USB and run:" -ForegroundColor Yellow
            Write-Host "    adb reverse tcp:8081 tcp:8081" -ForegroundColor Yellow
        }
        
        Write-Host ""
        Write-Host "  App URL: http://localhost:8081" -ForegroundColor White
    }
    "lan" {
        Write-Host "  Mode: LAN (WiFi)" -ForegroundColor Cyan
        Write-Host "  PC IP: $lanIP" -ForegroundColor Green
        $env:REACT_NATIVE_PACKAGER_HOSTNAME = $lanIP
        
        # Check firewall
        $blocked = Get-NetFirewallRule -DisplayName "node.exe" -ErrorAction SilentlyContinue |
            Where-Object { $_.Action -eq "Block" -and $_.Direction -eq "Inbound" }
        if ($blocked) {
            Write-Host ""
            Write-Host "  WARNING: Node.js is BLOCKED by Windows Firewall!" -ForegroundColor Red
            Write-Host "  Run fix-firewall.bat as Administrator first." -ForegroundColor Yellow
        }
        
        Write-Host ""
        Write-Host "  App URL: http://${lanIP}:8081" -ForegroundColor White
        Write-Host "  Phone must be on same WiFi network" -ForegroundColor DarkGray
    }
    "tunnel" {
        Write-Host "  Mode: Tunnel (any network)" -ForegroundColor Cyan
        $env:REACT_NATIVE_PACKAGER_HOSTNAME = "127.0.0.1"
        Write-Host "  Expo will create a public URL via ngrok" -ForegroundColor Green
        Write-Host ""
    }
}

Write-Host ""
Write-Host "  Starting Metro Bundler..." -ForegroundColor White
Write-Host "  Press Ctrl+C to stop" -ForegroundColor DarkGray
Write-Host ""

# --- Start Expo ---
$expoArgs = @("expo", "start")

switch ($Mode) {
    "lan"    { $expoArgs += "--host"; $expoArgs += "lan" }
    "tunnel" { $expoArgs += "--tunnel" }
}

& npx @expoArgs
