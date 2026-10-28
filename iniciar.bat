@echo off
rem Arranca el dev server de Vite directamente, sin pasar por npm
cd /d "%~dp0"
if not exist "node_modules\.bin\vite.cmd" (
    echo Faltan dependencias. Ejecuta "npm install" una vez y vuelve a intentar.
    pause
    exit /b 1
)
node_modules\.bin\vite.cmd
