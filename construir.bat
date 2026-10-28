@echo off
rem Build de produccion: typecheck (tsc -b) + build de Vite, sin pasar por npm
cd /d "%~dp0"
if not exist "node_modules\.bin\vite.cmd" (
    echo Faltan dependencias. Ejecuta "npm install" una vez y vuelve a intentar.
    pause
    exit /b 1
)
echo Ejecutando typecheck...
call node_modules\.bin\tsc.cmd -b
if errorlevel 1 (
    echo Typecheck fallo. Build cancelado.
    pause
    exit /b 1
)
echo Compilando con Vite...
call node_modules\.bin\vite.cmd build
if errorlevel 1 (
    echo Build fallo.
    pause
    exit /b 1
)
echo Build completado en la carpeta "dist".
pause
