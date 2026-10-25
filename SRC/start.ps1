<#
  Product Pulse - menu for Windows.
  Run it by double-clicking ProductPulse.bat, or from PowerShell:
      powershell -ExecutionPolicy Bypass -File start.ps1
#>

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$DataDir = Join-Path $Root '.local\product-pulse'
$BrowserFile = Join-Path $DataDir 'browser.json'

function Step($text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "   [ok] $text" -ForegroundColor Green }
function Warn($text) { Write-Host "   [!!] $text" -ForegroundColor Yellow }

function Open-Dashboard {
    $port = 8080
    try {
        $state = Get-Content (Join-Path $DataDir 'state.json') -Raw | ConvertFrom-Json
        if ($state.port) { $port = $state.port }
    } catch { }
    Start-Process "http://localhost:$port"
}

while ($true) {
    Write-Host ''
    Write-Host '  Product Pulse' -ForegroundColor Green
    Write-Host '  -------------' -ForegroundColor Green
    Write-Host '   1) Start Product Pulse'
    Write-Host '   2) Install or repair (Node.js, files, browser)'
    Write-Host '   3) Choose the browser (Chrome / Edge / Brave / Chromium)'
    Write-Host '   4) Open the dashboard in a browser'
    Write-Host '   5) Attach to a Chrome you already started'
    Write-Host '   6) Where is my data?'
    Write-Host '   7) Reset everything (wipes keywords and history)'
    Write-Host '   8) Quit'
    Write-Host ''

    $choice = Read-Host '   Type a number and press Enter'
    switch ($choice) {
        '1' {
            Step 'Starting'
            & (Join-Path $Root 'start.bat')
        }
        '2' {
            Step 'Install or repair'
            & (Join-Path $Root 'setup.bat')
        }
        '3' {
            Step 'Choose the browser'
            $Chips = @(
                @{ Id = 'chrome';  Label = 'Google Chrome'; Paths = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") },
                @{ Id = 'msedge';  Label = 'Microsoft Edge';  Paths = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe") },
                @{ Id = 'brave';   Label = 'Brave';            Paths = @("$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe", "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe", "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe") }
            )
            $Found = @()
            foreach ($chip in $Chips) {
                foreach ($path in $chip.Paths) {
                    if ($path -and (Test-Path $path)) { $Found += [pscustomobject]@{ Id = $chip.Id; Label = $chip.Label; Path = $path }; break }
                }
            }
            for ($i = 0; $i -lt $Found.Count; $i++) { Write-Host "     $($i + 1)) $($Found[$i].Label) - found" -ForegroundColor White }
            Write-Host "     $($Found.Count + 1)) Chromium (downloaded by the program)" -ForegroundColor White
            $answer = Read-Host '   Type the number and press Enter'
            if ($answer -match '^\d+$') {
                $index = [int]$answer - 1
                $picked = if ($index -ge 0 -and $index -lt $Found.Count) { $Found[$index] } else { [pscustomobject]@{ Id = 'chromium'; Label = 'Chromium'; Path = '' } }
                New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
                # Written without a byte order mark so the program can read it.
                $BrowserJson = @{ browser = $picked.Id; executablePath = $picked.Path } | ConvertTo-Json
                [System.IO.File]::WriteAllText($BrowserFile, $BrowserJson, (New-Object System.Text.UTF8Encoding $false))
                Ok "Browser set to $($picked.Label). Restart Product Pulse for it to take effect."
                if ($picked.Id -eq 'chromium') {
                    Write-Host '   Downloading the bundled Chromium (one time, about 150 MB)...' -ForegroundColor White
                    & npx playwright install chromium | Out-Null
                    Ok 'Chromium is ready.'
                }
            }
        }
        '4' { Open-Dashboard }
        '5' {
            Step 'Attach to a Chrome you already started'
            Write-Host '   1. Open a normal Chrome window' -ForegroundColor White
            Write-Host '   2. Start Chrome with a debugging port. Copy this line into' -ForegroundColor White
            Write-Host '      the Run box (Win+R) or a command prompt:' -ForegroundColor White
            Write-Host ''
            Write-Host '      "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%TEMP%\pulse-chrome"' -ForegroundColor Yellow
            Write-Host ''
            Write-Host '   3. In Product Pulse press Browser setup, then Attach to my Chrome' -ForegroundColor White
            Write-Host ''
            Read-Host '   Press Enter to continue'
        }
        '6' {
            Step 'Your data'
            Write-Host "   $DataDir" -ForegroundColor Gray
            Write-Host '   Your keywords, snapshots and settings live here. It never leaves your computer.' -ForegroundColor White
            Write-Host ''
            Read-Host '   Press Enter to continue'
        }
        '7' {
            Step 'Reset everything'
            Write-Host '   This deletes your keyword list, snapshots, alerts and settings.' -ForegroundColor Yellow
            $sure = Read-Host '   Type YES to continue'
            if ($sure -eq 'YES') {
                Remove-Item -Recurse -Force $DataDir -ErrorAction SilentlyContinue
                Ok 'Everything was reset. Start Product Pulse again to begin fresh.'
            } else { Warn 'Nothing was deleted.' }
            Read-Host '   Press Enter to continue'
        }
        '8' { break }
        default { Write-Host '   Pick a number from the list.' -ForegroundColor Yellow }
    }
    if ($choice -eq '8') { break }
}
