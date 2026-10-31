#!/usr/bin/env bash
# Tvbuild: inicia o painel local e abre o navegador.
# Para abrir também pelo celular na mesma rede:  ./iniciar-painel.sh --rede
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null || { echo "[ERRO] Node.js não encontrado. Instale: https://nodejs.org (ou: sudo apt install nodejs)"; exit 1; }
command -v adb  >/dev/null || echo "[AVISO] adb não encontrado: o painel abre, mas não conecta nos aparelhos (sudo apt install adb)."
if [ "${1:-}" != "--rede" ]; then
  ( sleep 1; xdg-open "http://localhost:7311" >/dev/null 2>&1 || open "http://localhost:7311" >/dev/null 2>&1 ) &
fi
exec node painel/server.js "$@"
