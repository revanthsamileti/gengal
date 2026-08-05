$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$cloudflared = Join-Path $root "cloudflared.exe"
$tunnelOut = Join-Path $root "backend_tunnel.out.log"
$tunnelErr = Join-Path $root "backend_tunnel.err.log"

if (-not (Test-Path $cloudflared)) {
  throw "cloudflared.exe not found at $cloudflared"
}

Write-Host "Stopping any existing cloudflared tunnel..."
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "cloudflared.exe" -and $_.CommandLine -like "*tunnel*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 1
Remove-Item -Force $tunnelOut, $tunnelErr -ErrorAction SilentlyContinue

Write-Host "Starting Cloudflare tunnel for port 5000..."
Start-Process `
  -FilePath $cloudflared `
  -ArgumentList "tunnel", "--url", "http://127.0.0.1:5000" `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $tunnelOut `
  -RedirectStandardError $tunnelErr

$backendUrl = $null
Write-Host "Waiting for tunnel URL..."
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
  Write-Host "Tunnel URL was not found. Last logs:"
  if (Test-Path $tunnelOut) { Get-Content $tunnelOut -Tail 20 }
  if (Test-Path $tunnelErr) { Get-Content $tunnelErr -Tail 20 }
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
Write-Host "Tunnel is ready: $backendUrl"
Write-Host "If Metro is running, please press 'r' in the Metro server terminal to reload the environment variables."
Write-Host ""
