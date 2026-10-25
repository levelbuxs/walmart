@echo off
title Product Pulse
cd /d "%~dp0"

rem ---------------------------------------------------------------------
rem  Product Pulse - the one file to click.
rem  Installs anything missing, then starts the monitor and the dashboard.
rem ---------------------------------------------------------------------

echo.
echo   Product Pulse
echo   ============
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   First run: installing Node.js and everything else.
  echo   This can take a couple of minutes. Please wait.
  echo.
  call "%~dp0setup.bat"
  if errorlevel 1 (
    echo.
    echo   Setup did not finish. The message above says what went wrong.
    pause
    exit /b 1
  )
  echo.
)

if not exist "%~dp0node_modules\playwright" (
  echo   Installing the program files...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   The install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
  echo.
)

call "%~dp0start.bat"
