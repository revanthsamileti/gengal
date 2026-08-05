param(
  [int]$BackendPort = 5000
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$backendDir = Join-Path $root "backend"
$python = Join-Path $backendDir "venv\Scripts\python.exe"

# Keep logs in a dedicated subfolder to keep root clean
$logsDir = Join-Path $PSScriptRoot ".logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir -Force | Out-Null }

$cloudflared = Join-Path $PSScriptRoot "cloudflared.exe"
$backendLog = Join-Path $logsDir "backend-server.log"
$backendErr = Join-Path $logsDir "backend-server.err.log"
$tunnelOut = Join-Path $logsDir "backend_tunnel.out.log"
$tunnelErr = Join-Path $logsDir "backend_tunnel.err.log"

if (-not (Test-Path $python)) {
  throw "Backend Python not found at $python"
}

if (-not (Test-Path $cloudflared)) {
  Write-Host "cloudflared.exe not found in scripts. Downloading automatically..." -ForegroundColor Cyan
  try {
    Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cloudflared -UseBasicParsing
  } catch {
    Write-Host "WARNING: Cloudflare download failed, will try system path or skip tunnel." -ForegroundColor Yellow
    $cloudflared = (Get-Command "cloudflared" -ErrorAction SilentlyContinue).Source
  }
}

Write-Host "Cleaning old GenGal backend/tunnel sessions..." -ForegroundColor DarkGray
Get-CimInstance Win32_Process |
  Where-Object {
    ($_.Name -eq "python.exe" -and $_.CommandLine -like "*app.py*") -or
    ($_.Name -eq "cloudflared.exe" -and $_.CommandLine -like "*$BackendPort*")
  } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

Write-Host "Starting Python Backend on port $BackendPort..." -ForegroundColor White
Start-Process `
  -FilePath $python `
  -ArgumentList "app.py" `
  -WorkingDirectory $backendDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $backendLog `
  -RedirectStandardError $backendErr

$backendReady = $false
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 1
  try {
    $body = @{ phone = "+919441488911" } | ConvertTo-Json
    Invoke-WebRequest `
      -Uri "http://127.0.0.1:$BackendPort/api/v1/auth/check-user" `
      -Method POST `
      -Body $body `
      -ContentType "application/json" `
      -UseBasicParsing `
      -TimeoutSec 2 | Out-Null
    $backendReady = $true
    break
  } catch {}
}

if (-not $backendReady) {
  Write-Host "WARNING: Backend response delayed, proceeding to tunnel..." -ForegroundColor Yellow
} else {
  Write-Host "Backend ready!" -ForegroundColor Green
}

if ($cloudflared -and (Test-Path $cloudflared)) {
  Remove-Item -Force $tunnelOut, $tunnelErr -ErrorAction SilentlyContinue

  Write-Host "Establishing secure public tunnel for backend..." -ForegroundColor White
  Start-Process `
    -FilePath $cloudflared `
    -ArgumentList "tunnel", "--url", "http://127.0.0.1:$BackendPort" `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $tunnelOut `
    -RedirectStandardError $tunnelErr

  $backendUrl = $null
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    $text = ""
    if (Test-Path $tunnelOut) { $text += Get-Content $tunnelOut -Raw -ErrorAction SilentlyContinue }
    if (Test-Path $tunnelErr) { $text += Get-Content $tunnelErr -Raw -ErrorAction SilentlyContinue }
    $match = [regex]::Match($text, "https://[a-zA-Z0-9-]+\.trycloudflare\.com")
    if ($match.Success) {
      $backendUrl = $match.Value
      break
    }
  }

  if ($backendUrl) {
    Write-Host "Backend Public URL: $backendUrl" -ForegroundColor Green
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
    [System.IO.File]::WriteAllText($envFile, $envContent.Trim())
    Write-Host "Updated .env automatically!" -ForegroundColor Green
  } else {
    Write-Host "WARNING: Cloudflare Tunnel took too long to assign a URL. Using existing .env settings." -ForegroundColor Yellow
  }
}
