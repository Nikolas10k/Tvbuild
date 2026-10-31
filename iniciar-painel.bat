@echo off
REM ==========================================================================
REM  Tvbuild - inicia o painel local e abre o navegador.
REM  Duplo clique: so neste PC.  Para usar no celular: iniciar-painel-celular.bat
REM  Este arquivo nao usa blocos com parenteses de proposito: assim funciona em
REM  qualquer pasta, inclusive com nomes como "Tvbuild (1)".
REM ==========================================================================
setlocal

REM Reabre dentro de "cmd /k" para a janela NUNCA fechar sozinha (erros ficam visiveis)
if "%~1"=="__tvbuild" goto inicio
set "TVB_ARGS=%*"
cmd /k ""%~f0" __tvbuild"
exit /b

:inicio
cd /d "%~dp0"
title Tvbuild - Painel

where node >nul 2>nul
if not errorlevel 1 goto temnode

echo [!] O Node.js nao esta instalado. Ele e necessario para o painel.
where winget >nul 2>nul
if errorlevel 1 goto semwinget
set "RESP="
set /p "RESP=    Instalar o Node.js LTS agora pelo winget, da fonte oficial? [S/N] "
if /i not "%RESP%"=="S" goto semwinget
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
echo.
echo [ok] Feche esta janela e abra o iniciar-painel.bat de novo.
goto :eof

:semwinget
echo     Baixe a versao LTS em https://nodejs.org e abra este arquivo de novo.
goto :eof

:temnode
node painel\preparar.js
if errorlevel 1 goto :eof
node painel\server.js --abrir %TVB_ARGS%
echo.
echo O painel foi encerrado. Pode fechar esta janela.
goto :eof
