@echo off
chcp 65001 >nul
title Instalando ComboWeb App
cd /d "%~dp0"
cls
echo ==============================================================
echo   INSTALACION DE ComboWeb App
echo   Por favor espere. Puede tardar unos minutos.
echo   No cierre esta ventana hasta que diga: LISTO.
echo ==============================================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo PROBLEMA - No encuentro Node.js en esta computadora.
  echo Instale Node.js como indica el Paso 1 de la guia,
  echo reinicie la computadora y haga doble clic otra vez aqui.
  echo.
  pause
  exit /b 1
)
echo Paso 1 de 2: preparando las piezas del sistema...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo PROBLEMA - No se pudieron descargar las piezas. Revise que la computadora
  echo tenga internet y vuelva a intentarlo.
  echo.
  pause
  exit /b 1
)
echo.
echo Paso 2 de 2: configurando el sistema...
node scripts\instalar.js
echo.
pause
