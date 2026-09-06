@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>&1
if %ERRORLEVEL%==0 (
  python start.py
  goto :eof
)

where py >nul 2>&1
if %ERRORLEVEL%==0 (
  py -3 start.py
  goto :eof
)

echo Python not found — falling back to Node.js directly.
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo Node.js is required. Install it from https://nodejs.org
  pause
  exit /b 1
)

if not exist ".env" if exist ".env.example" copy /Y ".env.example" ".env" >nul

if not exist "node_modules\express" (
  echo Installing npm dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting GPS-FAMILIA...
start "" "http://127.0.0.1:3000/"
node server.js
if errorlevel 1 pause
