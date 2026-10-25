<#
  Product Pulse - one-time setup for Windows.
  Run it by double-clicking setup.bat, or from PowerShell:
      powershell -ExecutionPolicy Bypass -File setup.ps1

  What it does:
    1. checks Node.js is installed (and offers to install it)
    2. installs the program dependencies
    3. finds Chrome / Edge / Brave and writes down which one to use
    4. creates a desktop shortcut
#>

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Step($text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "   [ok] $text" -ForegroundColor Green }
function Warn($text) { Write-Host "   [!!] $text" -ForegroundColor Yellow }
function Die($text)  { Write-Host "   [xx] $text" -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host '  Product Pulse - setup' -ForegroundColor Green
Write-Host '  ---------------------' -ForegroundColor Green
Write-Host '  Installing what is needed and getting your browser ready.'

# ---------------------------------------------------------------- Node.js ---
function Get-NodeVersion {
    try {
        $raw = & node --version 2>$null
        if ($raw) { return ($raw -replace '^v', '').Trim() }
    } catch { }
    return $null
}
function Get-NodeMajor($version) {
    if (-not $version) { return 0 }
    return [int](($version -split '\.')[0])
}

Step 'Checking Node.js'
$nodeVersion = Get-NodeVersion
if (Get-NodeMajor $nodeVersion) {
    Ok "Node.js $nodeVersion is installed."
} else {
    Warn 'Node.js was not found. Installing the current LTS release now.'
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Host '   This can take a minute.'
        & winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements | Out-Null
        $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
        $nodeVersion = Get-NodeVersion
        if (Get-NodeMajor $nodeVersion) { Ok "Node.js $nodeVersion is installed." }
        else { Die 'Node.js could not be installed automatically. Install it from https://nodejs.org and run this file again.' }
    } else {
        Die 'winget is not available. Install Node.js LTS from https://nodejs.org (the big green button), then run this file again.'
    }
}
if ((Get-NodeMajor $nodeVersion) -lt 20) {
    Die "Node.js $nodeVersion is too old. Install Node.js 20 or newer from https://nodejs.org and run this file again."
}

# ------------------------------------------------------------ Dependencies ---
Step 'Installing the program files'
Push-Location $Root
try {
    & npm ci --no-audit --no-fund | Out-Null
    if ($LASTEXITCODE -ne 0) { Die 'npm install failed. Check your internet connection and run this file again.' }
    Ok 'Dependencies installed.'
} finally { Pop-Location }

# --------------------------------------------------------------- Browsers ---
Step 'Looking for your browser'
$BrowserFile = Join-Path $Root '.local\product-pulse\browser.json'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $BrowserFile) | Out-Null

$Candidates = @(
    @{ Id = 'chrome';  Label = 'Google Chrome'; Paths = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") },
    @{ Id = 'msedge';  Label = 'Microsoft Edge';  Paths = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe") },
    @{ Id = 'brave';   Label = 'Brave';            Paths = @(
        "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
        "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe",
        "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe") }
)
$Found = @()
foreach ($candidate in $Candidates) {
    foreach ($path in $candidate.Paths) {
        if ($path -and (Test-Path $path)) { $Found += [pscustomobject]@{ Id = $candidate.Id; Label = $candidate.Label; Path = $path }; break }
    }
}
foreach ($browser in $Found) { Ok "$($browser.Label) found." }
if (-not $Found) { Warn 'No Chrome, Edge or Brave found. The bundled Chromium will be used instead.' }

$Chosen = $null
if ($Found.Count -gt 0) {
    $Chosen = $Found | Where-Object { $_.Id -eq 'chrome' } | Select-Object -First 1
    if (-not $Chosen) { $Chosen = $Found[0] }
    Write-Host ''
    Write-Host "   Which browser should Product Pulse open?" -ForegroundColor White
    for ($i = 0; $i -lt $Found.Count; $i++) { Write-Host "     $($i + 1)) $($Found[$i].Label)" -ForegroundColor White }
    Write-Host "     $($Found.Count + 1)) Chromium (downloaded by the program)" -ForegroundColor White
    $answer = Read-Host "   Type the number and press Enter [1]"
    if ($answer -match '^\d+$') {
        $index = [int]$answer - 1
        if ($index -ge 0 -and $index -lt $Found.Count) { $Chosen = $Found[$index] }
        else { $Chosen = [pscustomobject]@{ Id = 'chromium'; Label = 'Chromium'; Path = '' } }
    }
}
if (-not $Chosen) { $Chosen = [pscustomobject]@{ Id = 'chromium'; Label = 'Chromium'; Path = '' } }
# Written without a byte order mark: Windows PowerShell 5.1 adds one with
# -Encoding UTF8, and the program would then ignore the saved choice.
$BrowserJson = @{ browser = $Chosen.Id; executablePath = $Chosen.Path } | ConvertTo-Json
[System.IO.File]::WriteAllText($BrowserFile, $BrowserJson, (New-Object System.Text.UTF8Encoding $false))
Ok "Browser set to $($Chosen.Label)."

# The bundled Chromium is the only choice that needs a download of its own.
if ($Chosen.Id -eq 'chromium') {
    Step 'Downloading the bundled Chromium'
    Write-Host '   This is a one-time download of about 150 MB.'
    & npx playwright install chromium | Out-Null
    Ok 'Chromium is ready.'
}

# -------------------------------------------------------------- Shortcut ---
Step 'Creating a shortcut on your desktop'
try {
    $Desktop = [Environment]::GetFolderPath('Desktop')
    $ShortcutPath = Join-Path $Desktop 'Product Pulse.lnk'
    $Shell = New-Object -ComObject WScript.Shell
    $Shortcut = $Shell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = Join-Path $Root 'start.bat'
    $Shortcut.WorkingDirectory = $Root
    $Shortcut.Description = 'Product Pulse - Walmart reviewer monitor'
    $Shortcut.Save()
    Ok 'Desktop shortcut created.'
} catch {
    Warn 'Could not create the desktop shortcut. Just double-click start.bat instead.'
}

# --------------------------------------------------------------- Finished ---
Write-Host ''
Write-Host '  Setup is finished.' -ForegroundColor Green
Write-Host '  -------------------' -ForegroundColor Green
Write-Host ''
Write-Host '  Next:' -ForegroundColor White
Write-Host '    1. Double-click "Product Pulse" on your desktop (or start.bat here)'
Write-Host '    2. Click "Open browser" and sign in to Walmart once'
Write-Host '    3. Add your keywords in the Watchlist tab, then press Start'
Write-Host ''
Write-Host '  Everything is stored in this folder only:' -ForegroundColor White
Write-Host "    $Root\.local\product-pulse" -ForegroundColor Gray
Write-Host ''
Read-Host '  Press Enter to close'
