@echo off
REM Lane Scout batch runner - called by Task Scheduler.
REM Usage: run-batch.cmd [count]   (default 25)

setlocal
cd /d "%~dp0"

set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"

set "COUNT=%~1"
if "%COUNT%"=="" set "COUNT=25"

echo.>> "logs\runner.log"
echo ==== %DATE% %TIME% - starting batch of %COUNT% ====>> "logs\runner.log"

"%NODE%" scripts\batch.mjs --n=%COUNT% >> "logs\runner.log" 2>&1
set "RC=%ERRORLEVEL%"

echo ==== finished with exit code %RC% ====>> "logs\runner.log"
endlocal & exit /b %RC%
