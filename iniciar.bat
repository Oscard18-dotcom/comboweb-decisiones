@echo off
chcp 65001 >nul
title ComboWeb App - NO CIERRE ESTA VENTANA MIENTRAS USA EL SISTEMA
cd /d "%~dp0"
cls
echo ==============================================================
echo   ENCENDIENDO ComboWeb App
echo.
echo   * NO CIERRE ESTA VENTANA mientras use el sistema.
echo   * Para APAGAR el sistema, cierre esta ventana.
echo ==============================================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo PROBLEMA - No encuentro Node.js. Instalelo como indica el Paso 1 de la guia
  echo y reinicie la computadora.
  echo.
  pause
  exit /b 1
)
if not exist ".env" (
  echo PROBLEMA - El sistema todavia no esta instalado.
  echo Haga doble clic en instalar.bat primero.
  echo.
  pause
  exit /b 1
)
echo Guardando una copia de seguridad de los datos...
node scripts\respaldo.js --silencioso
echo.
echo El navegador se abrira solo en unos segundos...
start "" cmd /c "timeout /t 6 /nobreak >nul & start http://localhost:3000"
echo.
call npm start
echo.
echo ==============================================================
echo   El sistema se detuvo. Si no fue a proposito, tome una foto
echo   de esta pantalla y mandela a su persona de apoyo.
echo ==============================================================
pause
