@echo off
REM ==========================================================================
REM  coletar_e_backup.bat - Etapa 2 + backup, 100% Windows (sem Git Bash).
REM  NAO altera nada no aparelho; apenas le informacoes e salva em .txt.
REM  Uso: coletar_e_backup.bat 192.168.0.50
REM ==========================================================================
setlocal
if "%~1"=="" (echo Uso: %~nx0 IP_DO_APARELHO & exit /b 1)
set "T=%~1"
echo %T% | find ":" >nul || set "T=%~1:5555"
where adb >nul 2>nul || (echo [ERRO] adb.exe nao encontrado no PATH. & exit /b 1)

for /f "tokens=2 delims==" %%a in ('wmic os get localdatetime /value 2^>nul ^| find "="') do set "DT=%%a"
if defined DT (set "D=%DT:~0,4%-%DT:~4,2%-%DT:~6,2%_%DT:~8,6%") else (set "D=%RANDOM%")
set "IPDIR=%T::=_%"
set "IPDIR=%IPDIR:.=_%"
set "OUT=%~dp0..\saida\%IPDIR%"
if not exist "%OUT%" mkdir "%OUT%"

echo Conectando em %T% ...
adb connect %T%
adb -s %T% get-state >nul 2>nul || (echo [ERRO] Sem conexao. Confira IP e se aceitou o aviso na TV. & exit /b 1)

set "INFO=%OUT%\info_%D%.txt"
echo Coletando informacoes (getprop, meminfo, df)...
> "%INFO%" (
  echo Data: %D%   Alvo: %T%
  echo --- Modelo / Android / Chip ---
  adb -s %T% shell getprop ro.product.manufacturer
  adb -s %T% shell getprop ro.product.model
  adb -s %T% shell getprop ro.build.version.release
  adb -s %T% shell getprop ro.board.platform
  adb -s %T% shell getprop ro.hardware
  adb -s %T% shell wm size
  echo --- Memoria ---
  adb -s %T% shell "grep -E '^(MemTotal|MemFree|MemAvailable):' /proc/meminfo"
  echo --- Armazenamento ---
  adb -s %T% shell df -h /data
)
type "%INFO%"

set "BK=%OUT%\backup_%D%.txt"
echo Salvando backup (pacotes + configuracoes)...
> "%BK%" (
  echo ### BACKUP tvopt - %D% - %T%
  echo ### pm list packages -f
  adb -s %T% shell pm list packages -f
  echo ### pm list packages -d
  adb -s %T% shell pm list packages -d
  echo ### pm list packages -3
  adb -s %T% shell pm list packages -3
  echo ### settings list global
  adb -s %T% shell settings list global
  echo ### settings list secure
  adb -s %T% shell settings list secure
  echo ### settings list system
  adb -s %T% shell settings list system
  echo ### getprop
  adb -s %T% shell getprop
)
echo.
echo [ok] Informacoes: %INFO%
echo [ok] Backup     : %BK%
pause
endlocal
