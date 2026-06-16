@echo off
rem Avvia lo Studio (Drone pi + Granulone) in locale e apre il browser.
cd /d "%~dp0"
set PORT=8765
echo Studio attivo su http://localhost:%PORT%/
echo Lascia aperta questa finestra. Chiudila per spegnere il server.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%/"
where py >nul 2>nul && (py -m http.server %PORT%) || (python -m http.server %PORT%)
pause
