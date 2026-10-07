@echo off
setlocal
title Pavilion Fabrication Tracker V4
cd /d "%~dp0"
set "PORT=8092"
set "HOST=127.0.0.1"

where py >nul 2>&1
if %errorlevel%==0 (
  set "PYTHON_CMD=py"
) else (
  where python >nul 2>&1
  if %errorlevel%==0 (
    set "PYTHON_CMD=python"
  ) else (
    echo Python was not found.
    pause
    exit /b 1
  )
)

echo Starting Pavilion Tracker V4 at http://%HOST%:%PORT%/
start "" "http://%HOST%:%PORT%/index.html?v=4"
%PYTHON_CMD% -m http.server %PORT% --bind %HOST%
