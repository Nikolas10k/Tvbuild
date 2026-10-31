@echo off
REM ==========================================================================
REM  tvopt.bat - executa o tvopt.sh no Windows usando o Git Bash
REM  Uso: tvopt.bat <IP> <comando> [opcoes]      Ex.: tvopt.bat 192.168.0.50 info
REM  Requisitos: adb (no PATH ou na pasta platform-tools do projeto) e Git for Windows.
REM ==========================================================================
setlocal
if exist "%~dp0platform-tools\adb.exe" set "PATH=%~dp0platform-tools;%PATH%"
where adb >nul 2>nul || (echo [ERRO] adb.exe nao encontrado. Rode o iniciar-painel.bat uma vez para baixar, ou veja o README. & exit /b 1)
set "BASH="
if exist "%ProgramFiles%\Git\bin\bash.exe" set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not defined BASH if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" set "BASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not defined BASH if exist "%LocalAppData%\Programs\Git\bin\bash.exe" set "BASH=%LocalAppData%\Programs\Git\bin\bash.exe"
if not defined BASH (
  echo [ERRO] Git Bash nao encontrado. Instale o Git for Windows: https://git-scm.com/download/win
  echo        Sem Git Bash, use o painel: iniciar-painel.bat
  exit /b 1
)
"%BASH%" "%~dp0tvopt.sh" %*
endlocal
