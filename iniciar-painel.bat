@echo off
REM ==========================================================================
REM  Tvbuild - inicia o painel local e abre o navegador.
REM  Uso:  iniciar-painel.bat            (so neste PC)
REM        iniciar-painel.bat --rede     (tambem pelo celular / controle remoto)
REM ==========================================================================
setlocal
cd /d "%~dp0"
title Tvbuild - Painel

REM ---- Node.js ---------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo [!] O Node.js nao esta instalado. Ele e necessario para o painel.
  where winget >nul 2>nul
  if not errorlevel 1 (
    set /p RESP="    Instalar o Node.js LTS agora pelo winget (fonte oficial)? [S/N] "
    call :sim RESP && (
      winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
      echo.
      echo [ok] Feche esta janela e abra o iniciar-painel.bat de novo.
      pause & exit /b 0
    )
  )
  echo     Baixe a versao LTS em https://nodejs.org e rode este arquivo de novo.
  pause & exit /b 1
)

REM ---- ADB (Platform Tools) --------------------------------------------------
if exist "%~dp0platform-tools\adb.exe" set "PATH=%~dp0platform-tools;%PATH%"
where adb >nul 2>nul
if errorlevel 1 if not exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" if not exist "C:\platform-tools\adb.exe" (
  echo [!] O adb ^(Android Platform Tools^) nao foi encontrado.
  set /p RESP="    Baixar o Platform Tools oficial do Google para a pasta do projeto? [S/N] "
  call :sim RESP && (
    echo     Baixando de dl.google.com ...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; $z=Join-Path $env:TEMP 'platform-tools.zip'; Invoke-WebRequest 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile $z; Expand-Archive -Force $z '%~dp0.'; Remove-Item $z"
    if exist "%~dp0platform-tools\adb.exe" (
      echo [ok] adb instalado em %~dp0platform-tools
      set "PATH=%~dp0platform-tools;%PATH%"
    ) else (
      echo [ERRO] Nao consegui baixar. Veja o README, Passo 0.
    )
  )
)

node painel\server.js --abrir %*
pause
exit /b 0

:sim
setlocal EnableDelayedExpansion
set "v=!%~1!"
if /i "!v!"=="S" (endlocal & exit /b 0)
if /i "!v!"=="SIM" (endlocal & exit /b 0)
endlocal & exit /b 1
