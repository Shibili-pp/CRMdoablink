# Rebuild the web app and copy it into the Android WebView assets.
# Run from repo root before assembling the APK manually.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $root "frontend")
npm run build
$www = Join-Path $root "android\app\src\main\assets\www"
if (Test-Path $www) { Remove-Item -Recurse -Force (Join-Path $www "*") }
New-Item -ItemType Directory -Force -Path $www | Out-Null
Copy-Item -Recurse -Force (Join-Path $root "frontend\dist\*") $www
Write-Host "Synced frontend/dist -> android/app/src/main/assets/www"
Get-ChildItem $www -Recurse | Select-Object FullName, Length
