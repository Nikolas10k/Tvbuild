#!/usr/bin/env bash
# Tvbuild: inicia o painel local e abre o navegador.
#   bash iniciar-painel.sh           só neste PC
#   bash iniciar-painel.sh --rede    também pelo celular (painel e controle remoto)
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null; then
  echo "[ERRO] Node.js não encontrado. Instale a versão 18 ou mais nova: https://nodejs.org (ou: sudo apt install nodejs)"
  exit 1
fi

[ -x platform-tools/adb ] && export PATH="$PWD/platform-tools:$PATH"
if ! command -v adb >/dev/null; then
  echo "[!] adb (Android Platform Tools) não encontrado."
  if command -v unzip >/dev/null && command -v curl >/dev/null; then
    read -r -p "    Baixar o Platform Tools oficial do Google para a pasta do projeto? [s/N] " r
    if [[ "$r" =~ ^[sSyY] ]]; then
      so="linux"; [ "$(uname)" = "Darwin" ] && so="darwin"
      tmp="$(mktemp)"
      curl -fsSL "https://dl.google.com/android/repository/platform-tools-latest-$so.zip" -o "$tmp" && unzip -qo "$tmp" -d . && rm -f "$tmp"
      [ -x platform-tools/adb ] && export PATH="$PWD/platform-tools:$PATH" && echo "[ok] adb instalado em $PWD/platform-tools"
    fi
  else
    echo "    Instale com: sudo apt install adb   (ou sudo dnf install android-tools)"
  fi
fi

exec node painel/server.js --abrir "$@"
