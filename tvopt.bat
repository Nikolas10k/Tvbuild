@echo off
REM ==========================================================================
REM  tvopt.bat - executa o tvopt.sh no Windows usando o Git Bash
REM  Uso: tvopt.bat <IP> <comando> [opcoes]      Ex.: tvopt.bat 192.168.0.50 info
REM  Requisitos: adb.exe no PATH (Platform Tools) e Git for Windows instalado.
REM ==========================================================================
setlocal
where adb >nul 2>nul || (echo [ERRO] adb.exe nao encontrado no PATH. Veja o README. & exit /b 1)
set "BASH="
if exist "%ProgramFiles%\Git\bin\bash.exe" set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not defined BASH if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" set "BASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not defined BASH if exist "%LocalAppData%\Programs\Git\bin\bash.exe" set "BASH=%LocalAppData%\Programs\Git\bin\bash.exe"
if not defined BASH (
  echo [ERRO] Git Bash nao encontrado. Instale o Git for Windows: https://git-scm.com/download/win
  echo        Sem Git Bash voce ainda pode usar windows\coletar_e_backup.bat e os .bat gerados.
  exit /b 1
)
"%BASH%" "%~dp0tvopt.sh" %*
endlocal
