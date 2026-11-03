@echo off
REM Register daily Loanwalk Teams run (STG USA 23005). Run from an elevated or normal user session.
REM
REM   setup_schedule.bat              default 2:00 PM IST
REM   setup_schedule.bat remove       delete scheduled task
REM
REM Optional: set HC_TIME=HH:mm (IST) before setup_schedule.bat

setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

for %%I in ("%SCRIPT_DIR%\..") do set "REPO_ROOT=%%~fI"

set "BAT_PATH=%SCRIPT_DIR%\run_scheduled.bat"
set "PS1=%SCRIPT_DIR%\_register_task.ps1"
set "TASK_STG_23005=LoanwalkApiTests-STG-USA-23005"

set "ARG1=%~1"
if "%ARG1%"=="" set "ARG1=register"

if not exist "%BAT_PATH%" (
  echo ERROR: Missing "%BAT_PATH%"
  exit /b 1
)
if not exist "%PS1%" (
  echo ERROR: Missing "%PS1%"
  exit /b 1
)

if /I "%ARG1%"=="remove" goto :do_remove
if /I "%ARG1%"=="register" goto :do_stg_23005

echo Unknown option: %ARG1%
echo   setup_schedule.bat
echo   setup_schedule.bat remove
exit /b 1

:do_remove
schtasks /Delete /TN "%TASK_STG_23005%" /F 2>nul
echo Removed %TASK_STG_23005% (if it existed).
exit /b 0

:do_stg_23005
if not defined HC_TIME set "HC_TIME=14:00"
echo Registering STG USA 23005 at %HC_TIME% IST...
set "HC_TASK=%TASK_STG_23005%"
set "HC_BAT=%BAT_PATH%"
set "HC_DIR=%REPO_ROOT%"
set "HC_ENV=stg-usa-23005"
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%PS1%"
if errorlevel 1 exit /b 1
schtasks /Query /TN "%TASK_STG_23005%" /V /FO LIST | findstr /I /C:"TaskName" /C:"Status" /C:"Next Run Time" /C:"Schedule Type" /C:"Start Time" /C:"Task To Run"
echo.
echo Test: schtasks /Run /TN %TASK_STG_23005%
exit /b 0
