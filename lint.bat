@echo off
rem Lint con oxlint, sin pasar por npm
cd /d "%~dp0"
if not exist "node_modules\.bin\oxlint.cmd" (
    echo Faltan dependencias. Ejecuta "npm install" una vez y vuelve a intentar.
    pause
    exit /b 1
)
call node_modules\.bin\oxlint.cmd
pause
