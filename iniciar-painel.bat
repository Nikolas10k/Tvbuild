@echo off
REM ==========================================================================
REM  Tvbuild - inicia o painel local e abre o navegador.
REM  Requisitos: Node.js (https://nodejs.org) e adb.exe no PATH (Platform Tools).
REM  Para abrir tambem pelo celular na mesma rede:  iniciar-painel.bat --rede
REM ==========================================================================
cd /d "%~dp0"
where node >nul 2>nul || (
  echo [ERRO] Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e rode de novo.
  pause & exit /b 1
)
where adb >nul 2>nul || (
  echo [AVISO] adb.exe nao encontrado no PATH. O painel abre, mas nao conecta nos aparelhos.
  echo         Veja o README, Passo 0.
)
if /i "%~1"=="--rede" (
  echo Modo rede: use o link com codigo de acesso mostrado abaixo.
) else (
  start "" "http://localhost:7311"
)
node painel\server.js %*
pause
