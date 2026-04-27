param(
  [Parameter(Mandatory = $true)]
  [string]$ClientName,

  [string]$Destination
)

$ErrorActionPreference = "Stop"

$source = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

if ([string]::IsNullOrWhiteSpace($Destination)) {
  $parent = Split-Path $source -Parent
  $safeName = $ClientName.Trim() -replace '[\\/:*?"<>|]', '-'
  $Destination = Join-Path $parent $safeName
}

if (Test-Path -LiteralPath $Destination) {
  throw "Destino ja existe: $Destination"
}

$excludeDirs = @(
  ".git",
  ".vercel",
  ".playwright-profile",
  "node_modules",
  "dist"
)

$excludeFiles = @(
  ".env",
  ".env.local",
  ".env.*.local",
  "*.log"
)

New-Item -ItemType Directory -Path $Destination | Out-Null

robocopy $source $Destination /E /XD $excludeDirs /XF $excludeFiles | Out-Null
$exitCode = $LASTEXITCODE

if ($exitCode -ge 8) {
  throw "Robocopy falhou com codigo $exitCode"
}

$logDir = Join-Path $Destination "data\logs"
$screenshotDir = Join-Path $Destination "data\screenshots"

if (Test-Path -LiteralPath $logDir) {
  Get-ChildItem -LiteralPath $logDir -Filter "*.jsonl" -File | Remove-Item -Force
}

if (Test-Path -LiteralPath $screenshotDir) {
  Get-ChildItem -LiteralPath $screenshotDir -Filter "*.png" -File | Remove-Item -Force
}

Write-Host "Copia limpa criada em: $Destination"
Write-Host "Proximos passos:"
Write-Host "  cd `"$Destination`""
Write-Host "  npm install"
Write-Host "  copy .env.example .env.local"
Write-Host "  preencher as variaveis do novo cliente"
