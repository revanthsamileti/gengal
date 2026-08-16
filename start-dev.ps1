# GenGal Development Launcher
# Usage: .\start-dev.ps1 [-Mode lan|usb|tunnel]
# Defaults to USB mode (most reliable with adb reverse)

param(
    [ValidateSet("usb", "lan", "tunnel")]
    [string]$Mode = "usb"
)

$ErrorActionPreference = "Continue"

# Resolve adb rather than assuming one install location. The hardcoded
# "$env:LOCALAPPDATA\Android\Sdk\..." path this used to carry does not exist on
# every machine -- notably not on this one, where the SDK lives at C:\Android\sdk
# -- and because the calls below were all suffixed with `2>$null`, a missing adb
# failed completely silently: no device was ever found, no tunnel was ever
# opened, and the only symptom was the app failing to reach the packager.
$ADB = (Get-Command adb -ErrorAction SilentlyContinue).Source
if (-not $ADB) {
    $candidates = @(
        "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
        "C:\Android\sdk\platform-tools\adb.exe",
        "$env:ProgramFiles\Android\platform-tools\adb.exe",
        "${env:ProgramFiles(x86)}\Android\android-sdk\platform-tools\adb.exe"
    )
    foreach ($c in $candidates) { if (Test-Path $c) { $ADB = $c; break } }
}
if (-not $ADB) {
    Write-Host "  ERROR: adb not found. Install platform-tools or add adb to PATH." -ForegroundColor Red
}

# Must match the port in EXPO_PUBLIC_BACKEND_URL (.env). The app talks to the
# backend over this tunnel for RTC tokens and billing; without it every call
# fails at token prefetch with "Failed to connect to /127.0.0.1:5055", which
# looks like an app bug rather than a missing tunnel.
$BackendPort = 5055

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
        
        # Tunnel EVERY connected device, not just the first. Testing a call
        # needs two handsets, and only forwarding $devices[0] left the second
        # phone with no route to the packager or the backend -- so it silently
        # never rang, which reads as a broken call flow rather than a missing
        # tunnel on one device.
        $devices = @()
        if ($ADB) { $devices = & $ADB devices 2>$null | Select-String "device$" }

        if ($devices) {
            $serials = @($devices | ForEach-Object { ($_.Line -split "\s+")[0] })
            # ANDROID_SERIAL only makes sense when it is unambiguous; setting it
            # with several devices attached pins every later adb call to one.
            if ($serials.Count -eq 1) { $env:ANDROID_SERIAL = $serials[0] }

            foreach ($serial in $serials) {
                & $ADB -s $serial reverse tcp:8081 tcp:8081 2>$null
                & $ADB -s $serial reverse "tcp:$BackendPort" "tcp:$BackendPort" 2>$null
                Write-Host "  Device $serial : 8081 + $BackendPort forwarded" -ForegroundColor Green
            }
            Write-Host "  Tunnels drop when a phone sleeps or is replugged -- re-run this if calls stop connecting." -ForegroundColor DarkGray
        } else {
            Write-Host "  WARNING: No device connected. Plug in USB, enable USB debugging, then run:" -ForegroundColor Yellow
            Write-Host "    adb reverse tcp:8081 tcp:8081" -ForegroundColor Yellow
            Write-Host "    adb reverse tcp:$BackendPort tcp:$BackendPort" -ForegroundColor Yellow
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
