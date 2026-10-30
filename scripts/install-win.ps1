# Eve installer / updater for Windows.
#   From a downloaded folder:  double-click scripts\install-win.bat
#   Straight from GitHub:      irm https://raw.githubusercontent.com/austinrhermann/eve-mcp/main/scripts/install-win.ps1 | iex
$ErrorActionPreference = 'Stop'
$repo = if ($env:EVE_REPO) { $env:EVE_REPO } else { 'austinrhermann/eve-mcp' }
$dest = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.austin.eve'
$src = $null
if ($PSScriptRoot) {
  $cand = Split-Path -Parent $PSScriptRoot
  if (Test-Path (Join-Path $cand 'CSXS\manifest.xml')) { $src = $cand }
}
if (-not $src) {
  Write-Host 'Downloading the latest Eve from GitHub...'
  $tmp = Join-Path $env:TEMP ('eve-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'eve.zip'
  Invoke-WebRequest -UseBasicParsing "https://github.com/$repo/releases/latest/download/eve-extension.zip" -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp 'eve') -Force
  $src = Join-Path $tmp 'eve'
}
if ((Test-Path (Join-Path $src 'scripts')) -and -not (Test-Path (Join-Path $src 'lib\CSInterface.js'))) {  # fetch Adobe's CSInterface.js for local checkouts
  New-Item -ItemType Directory -Path (Join-Path $src 'lib') -Force | Out-Null
  Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_12.x/CSInterface.js' -OutFile (Join-Path $src 'lib\CSInterface.js')
}
$new = (Get-Content (Join-Path $src 'VERSION') -Raw).Trim()
$old = 'none'
if (Test-Path (Join-Path $dest 'VERSION')) { $old = (Get-Content (Join-Path $dest 'VERSION') -Raw).Trim() }

if (Test-Path (Join-Path $src 'scripts')) {  # local checkout: keep the manifest in sync with VERSION
  $mf = Join-Path $src 'CSXS\manifest.xml'
  $x = Get-Content $mf -Raw
  $x = $x -replace '(ExtensionBundleVersion=")[^"]*', ('${1}' + $new)
  $x = $x -replace '(<Extension Id="com.austin.eve.panel" Version=")[^"]*', ('${1}' + $new)
  Set-Content -Path $mf -Value $x -NoNewline
}

foreach ($v in 9..12) { reg add "HKCU\Software\Adobe\CSXS.$v" /v PlayerDebugMode /t REG_SZ /d 1 /f | Out-Null }

if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Path $dest -Force | Out-Null
robocopy $src $dest /E /XD scripts .github .git dist /XF README.md .debug | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copy failed (robocopy code $LASTEXITCODE)" }

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Write-Host "! Claude Code not found. Install it, then run 'claude' once to sign in." }
Write-Host "Eve $old -> $new installed."
Write-Host 'Quit and reopen After Effects, then open Window > Extensions > Eve (or Extensions (Legacy) > Eve).'
