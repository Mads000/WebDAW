@echo off
rem Startet die WebDAW in Chrome oder Edge als eigenes Fenster.
rem Ohne Chrome/Edge wird der Standardbrowser verwendet (dort ungetestet).
setlocal EnableDelayedExpansion

set "HTML=%~dp0index.html"
if not exist "%HTML%" (
    echo index.html nicht gefunden: "%HTML%"
    pause
    exit /b 1
)

rem Pfad in eine file:-URL umwandeln (Backslashes und Leerzeichen)
set "URL=!HTML:\=/!"
set "URL=file:///!URL: =%%20!"

set "BROWSER="
for %%B in (
    "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
    "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
    "%LocalAppData%\Google\Chrome\Application\chrome.exe"
    "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
    "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
) do (
    if not defined BROWSER if exist "%%~B" set "BROWSER=%%~B"
)

if defined BROWSER (
    start "" "!BROWSER!" --app="!URL!"
) else (
    echo Chrome oder Edge nicht gefunden, oeffne Standardbrowser ...
    start "" "!HTML!"
)
endlocal
