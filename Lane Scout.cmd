@echo off
REM Start Lane Scout and open it in your browser.
REM Double-click this file. Close the window to stop the server.

setlocal
cd /d "%~dp0"
title Lane Scout

set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"

echo.
echo   Lane Scout
echo   ----------
echo   Starting on http://localhost:8099
echo   Close this window to stop it.
echo.

REM give the server a moment to bind, then open the browser
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8099"

"%NODE%" scripts\serve.mjs

REM if we get here the server exited — keep the window open so the error is readable
echo.
echo   Server stopped (exit code %ERRORLEVEL%).
echo.
pause
