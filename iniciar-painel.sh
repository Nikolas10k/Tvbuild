#!/usr/bin/env bash
# Tvbuild: inicia o painel local e abre o navegador.
#   bash iniciar-painel.sh           só neste PC
#   bash iniciar-painel.sh --rede    também pelo celular (painel e controle remoto)
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null; then
  echo "[ERRO] Node.js não encontrado. Instale a versão 18 ou mais nova: https://nodejs.org (ou: sudo apt install nodejs)"
  exit 1
fi
node painel/preparar.js || exit 1
exec node painel/server.js --abrir "$@"
