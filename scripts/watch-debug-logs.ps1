$logPath = Join-Path $PSScriptRoot '..\backend\debug_events.log'

if (-not (Test-Path $logPath)) {
  New-Item -ItemType File -Path $logPath -Force | Out-Null
}

Write-Host "Watching $logPath"
Get-Content -Path $logPath -Wait -Tail 50
