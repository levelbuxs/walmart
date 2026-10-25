@echo off
title Product Pulse
cd /d "%~dp0"

echo.
echo   Starting Product Pulse...
echo   -----------------------
echo   The dashboard opens in your browser. Keep this window open.
echo   Press Ctrl+C to stop it.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js was not found. Running setup first...
  echo.
  call "%~dp0setup.bat"
  if errorlevel 1 (
    echo.
    echo   Setup failed. See the message above.
    pause
    exit /b 1
  )
)

if not exist "%~dp0node_modules\playwright" (
  echo   Installing the program files for the first time...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   The install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
  echo.
)

node server.js
echo.
echo   Product Pulse has stopped.
pause >nul
