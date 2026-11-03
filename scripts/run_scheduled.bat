@echo off
setlocal EnableExtensions
REM Scheduled Teams runner for Backendapi loanwalk (STG 23005).
REM   run_scheduled.bat
REM   run_scheduled.bat stg-usa-23005

set "PROFILE=%~1"
if "%PROFILE%"=="" set "PROFILE=stg-usa-23005"

cd /d "%~dp0.."
if errorlevel 1 (
  echo [ERROR] Could not cd to repo root.
  exit /b 2
)

set "REPO_ROOT=%CD%"
set "LOG_DIR=%REPO_ROOT%\logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%I"
if not defined STAMP set "STAMP=run"
set "LOG_FILE=%LOG_DIR%\teams-%PROFILE%-%STAMP%.log"

echo ============================================================>> "%LOG_FILE%"
echo Loanwalk API automation — %PROFILE%>> "%LOG_FILE%"
echo Started: %DATE% %TIME%>> "%LOG_FILE%"
echo Repo:    %REPO_ROOT%>> "%LOG_FILE%"
echo ============================================================>> "%LOG_FILE%"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] node.exe not found on PATH.>> "%LOG_FILE%"
  exit /b 2
)

if not exist "%REPO_ROOT%\.env" (
  echo [ERROR] Missing .env in repo root.>> "%LOG_FILE%"
  exit /b 2
)

findstr /R /C:"^TEAMS_WEBHOOK_URL=." "%REPO_ROOT%\.env" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] TEAMS_WEBHOOK_URL not set in .env>> "%LOG_FILE%"
  exit /b 2
)

if not exist "%REPO_ROOT%\node_modules\@playwright\test\cli.js" (
  echo [ERROR] Run npm install from repo root first.>> "%LOG_FILE%"
  exit /b 2
)

if /I "%PROFILE%"=="stg-usa-23005" (
  set "NPM_SCRIPT=gmwalk"
  set "TEAMS_NOTIFY=1"
) else (
  echo [ERROR] Unknown profile: %PROFILE%>> "%LOG_FILE%"
  echo         Use stg-usa-23005
  exit /b 2
)

echo [INFO] Running npm run %NPM_SCRIPT% ...
echo [INFO] Log: %LOG_FILE%

call npm run %NPM_SCRIPT% >> "%LOG_FILE%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"

echo.>> "%LOG_FILE%"
echo Finished: %DATE% %TIME%  exit=%EXIT_CODE%>> "%LOG_FILE%"
echo [INFO] Finished with exit code %EXIT_CODE%
echo [INFO] Log saved to %LOG_FILE%

exit /b %EXIT_CODE%
