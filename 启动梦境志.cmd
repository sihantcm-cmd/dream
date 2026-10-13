@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.12 or later first.
  pause
  exit /b 1
)
if not exist .env copy .env.example .env >nul
if not exist node_modules (
  call npm.cmd ci
  if errorlevel 1 goto failed
)
call npm.cmd run build
if errorlevel 1 goto failed
echo Open http://127.0.0.1:3000 in your browser. Press Ctrl+C to stop.
call npm.cmd start
if errorlevel 1 goto failed
exit /b 0
:failed
echo Startup failed. See the message above and README.md.
pause
exit /b 1
