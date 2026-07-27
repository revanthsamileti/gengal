param(
  [int]$BackendPort = 5000
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$backendDir = Join-Path $root "backend"
$python = Join-Path $backendDir "venv\Scripts\python.exe"
$cloudflared = Join-Path $root "cloudflared.exe"
$backendLog = Join-Path $root "backend-server.log"
$backendErr = Join-Path $root "backend-server.err.log"
$tunnelOut = Join-Path $root "backend_tunnel.out.log"
$tunnelErr = Join-Path $root "backend_tunnel.err.log"

if (-not (Test-Path $python)) {
  throw "Backend Python not found at $python"
}

if (-not (Test-Path $cloudflared)) {
  throw "cloudflared.exe not found at $cloudflared"
}

Write-Host "Stopping old GenGal backend/tunnel processes..."
Get-CimInstance Win32_Process |
  Where-Object {
    ($_.Name -eq "python.exe" -and $_.CommandLine -like "*app.py*") -or
    ($_.Name -eq "cloudflared.exe" -and $_.CommandLine -like "*$BackendPort*")
  } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

# Free up Metro port 8081 if currently in use
Write-Host "Freeing up Metro port 8081 if in use..."
Get-NetTCPConnection -LocalPort 8081 -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.OwningProcess -and $_.OwningProcess -ne $PID) {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

Start-Sleep -Seconds 2

Write-Host "Starting backend on http://127.0.0.1:$BackendPort ..."
Start-Process `
  -FilePath $python `
  -ArgumentList "app.py" `
  -WorkingDirectory $backendDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $backendLog `
  -RedirectStandardError $backendErr

$backendReady = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $body = @{ phone = "+919441488911" } | ConvertTo-Json
    Invoke-WebRequest `
      -Uri "http://127.0.0.1:$BackendPort/api/v1/auth/check-user" `
      -Method POST `
      -Body $body `
      -ContentType "application/json" `
      -UseBasicParsing `
      -TimeoutSec 3 | Out-Null
    $backendReady = $true
    break
  } catch {}
}

if (-not $backendReady) {
  Write-Host "Backend did not become ready. Last backend error log:"
  if (Test-Path $backendErr) {
    Get-Content $backendErr -Tail 80
  }
  throw "Backend startup failed"
}

Remove-Item -Force $tunnelOut, $tunnelErr -ErrorAction SilentlyContinue

Write-Host "Starting Cloudflare tunnel for backend..."
Start-Process `
  -FilePath $cloudflared `
  -ArgumentList "tunnel", "--url", "http://127.0.0.1:$BackendPort" `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $tunnelOut `
  -RedirectStandardError $tunnelErr

$backendUrl = $null
for ($i = 0; $i -lt 45; $i++) {
  Start-Sleep -Seconds 2
  $text = ""
  if (Test-Path $tunnelOut) { $text += Get-Content $tunnelOut -Raw }
  if (Test-Path $tunnelErr) { $text += Get-Content $tunnelErr -Raw }
  $match = [regex]::Match($text, "https://[a-zA-Z0-9-]+\.trycloudflare\.com")
  if ($match.Success) {
    $backendUrl = $match.Value
    break
  }
}

if (-not $backendUrl) {
  Write-Host "Tunnel URL was not found. Last tunnel logs:"
  if (Test-Path $tunnelOut) { Get-Content $tunnelOut -Tail 80 }
  if (Test-Path $tunnelErr) { Get-Content $tunnelErr -Tail 80 }
  throw "Cloudflare tunnel startup failed"
}

# Automatically update .env file
$envFile = Join-Path $root ".env"
if (Test-Path $envFile) {
  $envContent = Get-Content $envFile -Raw
  if ($envContent -match "EXPO_PUBLIC_BACKEND_URL=.*") {
    $envContent = $envContent -replace "EXPO_PUBLIC_BACKEND_URL=.*", "EXPO_PUBLIC_BACKEND_URL=$backendUrl"
  } else {
    $envContent += "`r`nEXPO_PUBLIC_BACKEND_URL=$backendUrl"
  }
} else {
  $envContent = "EXPO_PUBLIC_BACKEND_URL=$backendUrl"
}
[System.IO.File]::WriteAllText($envFile, $envContent)
Write-Host "Auto-updated .env with EXPO_PUBLIC_BACKEND_URL=$backendUrl"

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "          GENGAL DEV INFRASTRUCTURE READY                 " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Backend Tunnel URL is: $backendUrl" -ForegroundColor Cyan
Write-Host "The .env file has been updated automatically."
Write-Host ""
Write-Host "IMPORTANT REMINDER:"
Write-Host "Please shake your phone (or pull down in Expo Go) and tap"
Write-Host "RELOAD to load the new backend connection on your devices." -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""

