@echo off
title Product Pulse - Setup
cd /d "%~dp0"

echo.
echo   Product Pulse - setup
echo   ---------------------
echo   This installs what is needed. It is safe to run more than once.
echo.

where powershell >nul 2>nul
if errorlevel 1 (
  echo   PowerShell was not found. Run setup.ps1 manually instead.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
if errorlevel 1 (
  echo.
  echo   Setup did not finish. The message above says what went wrong.
  pause
  exit /b 1
)
