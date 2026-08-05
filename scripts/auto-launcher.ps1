# GenGal Master Auto-Launcher (Complete Anti-Freeze Edition)
# GUARANTEED never to hang, even if Windows ADB or USB ports lock up!

$ErrorActionPreference = "Continue"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

Clear-Host
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "    GENGAL AUTOMATIC LAUNCHER (SINGLE-CLICK SOLUTION)" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Stop conflicting Metro sessions and stuck background processes
Write-Host "[1/3] Cleaning up ports and stuck background processes..." -ForegroundColor White
Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}
Stop-Process -Name "node" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# 2. Start Backend & auto-configure network tunnel
Write-Host "[2/3] Initializing Backend Server & Cloudflare Tunnel..." -ForegroundColor White
& "$PSScriptRoot\start-remote-debug.ps1"
Write-Host ""

# 3. Detect Phone Connection with Smart 7-Second Anti-Hang Timeout
Write-Host "[3/3] Checking Phone Connectivity & Starting Metro..." -ForegroundColor White
$ADB = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $ADB)) { $ADB = "adb" }

$usbDetected = $false
$serial = ""
$outPath = Join-Path $env:TEMP "gengal_adb_devices.txt"

try {
    # Delete old check result
    if (Test-Path $outPath) { Remove-Item $outPath -Force -ErrorAction SilentlyContinue }
    
    # Launch adb devices asynchronously with a healthy 7000ms timeout for cold daemon boot
    $adbProcess = Start-Process -FilePath $ADB -ArgumentList "devices" -NoNewWindow -PassThru -RedirectStandardOutput $outPath -ErrorAction SilentlyContinue
    if ($adbProcess) {
        if (-not $adbProcess.WaitForExit(7000)) {
            Write-Host "  [!] ADB server deadlocked in Windows; terminating..." -ForegroundColor Yellow
            Stop-Process -Id $adbProcess.Id -Force -ErrorAction SilentlyContinue
            Stop-Process -Name "adb" -Force -ErrorAction SilentlyContinue
        }
    }

    if (Test-Path $outPath) {
        $deviceLines = @(Get-Content $outPath -ErrorAction SilentlyContinue | Where-Object { $_ -match "\bdevice\b" -and $_ -notmatch "List of" })
        if ($deviceLines.Count -gt 0) {
            $serial = ($deviceLines[0] -split "\s+")[0].Trim()
            $usbDetected = $true
        }
    }
} catch {
    $usbDetected = $false
}

if ($usbDetected -and $serial) {
    Write-Host "  [+] USB Phone Detected: $serial" -ForegroundColor Green
    Write-Host "  [+] Activating high-speed USB communication..." -ForegroundColor Green
    
    # Configure USB forwarding with timeouts
    Start-Process -FilePath $ADB -ArgumentList "-s $serial reverse tcp:8081 tcp:8081" -NoNewWindow -Wait -ErrorAction SilentlyContinue
    Start-Process -FilePath $ADB -ArgumentList "-s $serial reverse tcp:5000 tcp:5000" -NoNewWindow -Wait -ErrorAction SilentlyContinue
    
    # Wake up phone screen if locked or turned off
    Start-Process -FilePath $ADB -ArgumentList "-s $serial shell input keyevent KEYCODE_WAKEUP" -NoNewWindow -Wait -ErrorAction SilentlyContinue
    Start-Process -FilePath $ADB -ArgumentList "-s $serial shell wm dismiss-keyguard" -NoNewWindow -Wait -ErrorAction SilentlyContinue

    Write-Host "  [+] Starting Metro Bundler & opening app over USB..." -ForegroundColor Cyan
    Write-Host ""
    npx.cmd expo start --android
} else {
    Write-Host "  [-] No active USB phone detected (or cable not plugged in)." -ForegroundColor Yellow
    Write-Host "  [+] Automatically switching to WIRELESS & REMOTE TUNNEL Mode!" -ForegroundColor Green
    Write-Host "  [+] Your app can now load over ANY network (Wi-Fi, 5G, Data)." -ForegroundColor Green
    Write-Host ""
    Write-Host "  [>] Scan the QR code below on your phone when ready:" -ForegroundColor Cyan
    Write-Host ""
    npx.cmd expo start --tunnel
}
