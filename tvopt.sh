#!/usr/bin/env bash
# =============================================================================
# tvopt.sh — Otimização segura de Android TV / TV box / projetor via ADB
#
# SEM root, SEM flash, SEM bootloader. Toda alteração é registrada e pode ser
# desfeita com:  ./tvopt.sh <IP> desfazer
#
# Uso:  ./tvopt.sh <IP[:porta]> <comando> [opções]
#       ./tvopt.sh ajuda
#
# Variáveis de ambiente:
#   SIMULAR=1   mostra os comandos de alteração sem executá-los (dry-run)
#   SIM=1       responde "sim" automaticamente às confirmações (use com cuidado)
# =============================================================================
set -u

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$RAIZ/config"
DATA="$(date +%Y-%m-%d_%H%M%S)"
SIMULAR="${SIMULAR:-0}"
SIM="${SIM:-0}"

# -----------------------------------------------------------------------------
# Utilitários de saída
# -----------------------------------------------------------------------------
if [ -t 1 ]; then
  C_AZ=$'\e[1;36m'; C_AM=$'\e[1;33m'; C_VD=$'\e[1;32m'; C_VM=$'\e[1;31m'; C_0=$'\e[0m'
else
  C_AZ=""; C_AM=""; C_VD=""; C_VM=""; C_0=""
fi
titulo() { printf '\n%s==== %s ====%s\n' "$C_AZ" "$*" "$C_0"; }
info()   { printf '%s[i]%s %s\n' "$C_AZ" "$C_0" "$*"; }
ok()     { printf '%s[ok]%s %s\n' "$C_VD" "$C_0" "$*"; }
aviso()  { printf '%s[!]%s %s\n' "$C_AM" "$C_0" "$*"; }
erro()   { printf '%s[ERRO]%s %s\n' "$C_VM" "$C_0" "$*" >&2; }
morrer() { erro "$*"; exit 1; }

# Explica um comando antes de executá-lo (pedido do projeto: explicar antes de rodar)
explicar() { printf '%s  ->%s %s\n     %s$ %s%s\n' "$C_AM" "$C_0" "$1" "$C_AZ" "$2" "$C_0"; }

confirmar() { # confirmar "pergunta"  -> 0 = sim
  if [ "$SIM" = "1" ]; then printf '%s [s/N] s (SIM=1)\n' "$1"; return 0; fi
  local r; read -r -p "$1 [s/N] " r </dev/tty || return 1
  [[ "$r" =~ ^[sSyY] ]]
}

# -----------------------------------------------------------------------------
# ADB
# -----------------------------------------------------------------------------
ALVO=""; SAIDA=""; ESTADO=""; LOG=""

preparar_alvo() {
  [ -x "$RAIZ/platform-tools/adb" ] && export PATH="$RAIZ/platform-tools:$PATH"
  [ -x "$RAIZ/platform-tools/adb.exe" ] && export PATH="$RAIZ/platform-tools:$PATH"
  command -v adb >/dev/null 2>&1 || morrer "adb não encontrado. Instale o Android Platform Tools (veja o README)."
  ALVO="$1"
  [[ "$ALVO" == *:* ]] || ALVO="$ALVO:5555"
  SAIDA="$RAIZ/saida/${ALVO//[:.]/_}"
  ESTADO="$SAIDA/estado"
  LOG="$ESTADO/alteracoes.log"
  mkdir -p "$ESTADO"
}

a()  { adb -s "$ALVO" "$@"; }
sh_() { adb -s "$ALVO" shell "$@" </dev/null 2>/dev/null | tr -d '\r'; }

conectar() {
  if adb devices | tr -d '\r' | grep -q "^$ALVO[[:space:]]*device$"; then return 0; fi
  info "Conectando em $ALVO ..."
  adb connect "$ALVO" | tr -d '\r'
  sleep 1
  if ! adb devices | tr -d '\r' | grep -q "^$ALVO[[:space:]]*device$"; then
    if adb devices | tr -d '\r' | grep -q "^$ALVO[[:space:]]*unauthorized"; then
      morrer "Aparelho não autorizou o PC. Aceite o aviso 'Permitir depuração USB/rede?' na tela e rode de novo."
    fi
    morrer "Não foi possível conectar em $ALVO. Confira IP, mesma rede e se a depuração ADB em rede está ativa."
  fi
  ok "Conectado em $ALVO"
}

# Executa um comando de ALTERAÇÃO no aparelho (respeita SIMULAR=1)
alterar() {
  if [ "$SIMULAR" = "1" ]; then printf '     [SIMULAÇÃO] adb shell %s\n' "$*"; return 0; fi
  local out; out="$(adb -s "$ALVO" shell "$@" </dev/null 2>&1 | tr -d '\r')"
  [ -n "$out" ] && printf '     %s\n' "$out"
  # pm e cmd devolvem 0 mesmo com erro em alguns Androids; detecta pelo texto
  if printf '%s' "$out" | grep -qiE 'exception|error|failure|unknown|not found|denied'; then return 1; fi
  return 0
}

registrar() { [ "$SIMULAR" = "1" ] || printf '%s\n' "$*" >> "$LOG"; }

# -----------------------------------------------------------------------------
# Informações do aparelho
# -----------------------------------------------------------------------------
android_sdk()     { sh_ getprop ro.build.version.sdk; }
pacotes_todos()   { sh_ pm list packages | sed 's/^package://' | sort; }
pacotes_ativos()  { sh_ pm list packages -e | sed 's/^package://' | sort; }
pacotes_off()     { sh_ pm list packages -d | sed 's/^package://' | sort; }
pacotes_usuario() { sh_ pm list packages -3 | sed 's/^package://' | sort; }
instalado()       { pacotes_todos | grep -qx "$1"; }

launcher_atual() { # devolve pacote/atividade da tela inicial atual
  local r
  r="$(sh_ cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME \
       | grep -E '^[A-Za-z0-9_.]+/[A-Za-z0-9_.$]+$' | tail -n1)"
  [ -n "$r" ] && { echo "$r"; return; }
  # Fallback para Androids antigos
  sh_ dumpsys package preferred-activities | grep -oE '[A-Za-z0-9_.]+/[A-Za-z0-9_.$]+' | head -n1
}
pacote_launcher_atual() { launcher_atual | cut -d/ -f1; }

launchers_disponiveis() { # todas as atividades HOME instaladas
  sh_ cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.HOME \
    | grep -E '^[[:space:]]*[A-Za-z0-9_.]+/[A-Za-z0-9_.$]+[[:space:]]*$' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

teclado_atual() { sh_ settings get secure default_input_method | cut -d/ -f1; }

mem_disponivel_kb() { sh_ cat /proc/meminfo | awk '/^MemAvailable:/ {print $2}'; }

# -----------------------------------------------------------------------------
# Proteção
# -----------------------------------------------------------------------------
padroes_protegidos() { grep -vE '^[[:space:]]*(#|$)' "$CONFIG/protegidos.txt"; }
lista_config()       { sed 's/#.*//' "$CONFIG/$1" | awk 'NF {print $1}'; }
descricao_config()   { grep -E "^$(printf '%s' "$2" | sed 's/\./\\./g')[[:space:]]" "$CONFIG/$1" | sed -n 's/.*#[[:space:]]*//p' | head -n1; }

PROT_LAUNCHER=""; PROT_LAUNCHERS=""; PROT_TECLADO=""; PROT_REGEX=""
carregar_protecao_dinamica() {
  PROT_REGEX="$(padroes_protegidos | paste -sd'|' -)"
  PROT_LAUNCHER="$(pacote_launcher_atual)"
  PROT_TECLADO="$(teclado_atual)"
  # Sem tela inicial padrão o Android responde com o seletor do sistema ("android"):
  # nesse caso, todas as telas iniciais ficam protegidas.
  PROT_LAUNCHERS=""
  if [ -z "$PROT_LAUNCHER" ] || [ "$PROT_LAUNCHER" = "android" ]; then
    PROT_LAUNCHERS=" $(launchers_disponiveis | cut -d/ -f1 | sort -u | tr '\n' ' ') "
  fi
}

# protegido <pacote> [ignorar_padroes] -> 0 se NÃO pode mexer; imprime motivo
protegido() {
  local p="$1" ignorar="${2:-0}"
  if [ -n "$PROT_LAUNCHER" ] && [ "$p" = "$PROT_LAUNCHER" ]; then echo "launcher em uso"; return 0; fi
  if [[ "$PROT_LAUNCHERS" == *" $p "* ]]; then echo "pode ser o launcher em uso (nenhuma tela inicial padrão)"; return 0; fi
  if [ -n "$PROT_TECLADO" ] && [ "$p" = "$PROT_TECLADO" ]; then echo "teclado em uso"; return 0; fi
  [ "$ignorar" = "1" ] && return 1
  [ -n "$PROT_REGEX" ] || PROT_REGEX="$(padroes_protegidos | paste -sd'|' -)"
  printf '%s' "$p" | grep -qiE -- "$PROT_REGEX" || return 1
  local pad
  while IFS= read -r pad; do
    if printf '%s' "$p" | grep -qiE -- "$pad"; then echo "padrão protegido: $pad"; return 0; fi
  done < <(padroes_protegidos)
  return 1
}

exigir_backup() {
  ls "$SAIDA"/backup_*.txt >/dev/null 2>&1 && return 0
  aviso "Nenhum backup encontrado para $ALVO. Fazendo o backup agora (obrigatório antes de alterar)."
  cmd_backup
}

# =============================================================================
# COMANDOS
# =============================================================================

# --- 2. info -----------------------------------------------------------------
cmd_info() {
  titulo "Informações do aparelho ($ALVO)"
  local arq="$SAIDA/info_$DATA.txt"
  explicar "Lê propriedades do sistema (modelo, Android, chip)" "getprop ro.product.model / ro.build.version.release / ro.board.platform"
  explicar "Lê a memória RAM total e disponível" "cat /proc/meminfo"
  explicar "Lê o armazenamento livre da partição de dados" "df -h /data"
  {
    echo "Data: $DATA   Alvo: $ALVO"
    echo "Fabricante : $(sh_ getprop ro.product.manufacturer)"
    echo "Marca      : $(sh_ getprop ro.product.brand)"
    echo "Modelo     : $(sh_ getprop ro.product.model)"
    echo "Dispositivo: $(sh_ getprop ro.product.device)"
    echo "Android    : $(sh_ getprop ro.build.version.release) (SDK $(android_sdk))"
    echo "Build      : $(sh_ getprop ro.build.display.id)"
    echo "Patch seg. : $(sh_ getprop ro.build.version.security_patch)"
    echo "Plataforma : $(sh_ getprop ro.board.platform)  hardware=$(sh_ getprop ro.hardware)  soc=$(sh_ getprop ro.soc.model)"
    echo "CPU (ABI)  : $(sh_ getprop ro.product.cpu.abi)  núcleos=$(sh_ cat /proc/cpuinfo | grep -c '^processor')"
    sh_ cat /proc/cpuinfo | grep -iE '^(Hardware|model name)' | sort -u | sed 's/^/CPU info   : /'
    echo "Resolução  : $(sh_ wm size | tr '\n' ' ')  densidade: $(sh_ wm density | tr '\n' ' ')"
    echo "Launcher   : $(launcher_atual)"
    echo "Teclado    : $(sh_ settings get secure default_input_method)"
    echo
    echo "--- Memória (/proc/meminfo) ---"
    sh_ cat /proc/meminfo | grep -E '^(MemTotal|MemFree|MemAvailable|Cached|SwapTotal|SwapFree):'
    echo
    echo "--- Armazenamento (df -h /data) ---"
    sh_ df -h /data
    echo
    echo "--- Pacotes: $(pacotes_todos | wc -l) instalados, $(pacotes_usuario | wc -l) instalados por você, $(pacotes_off | wc -l) desativados ---"
  } | tee "$arq"
  local m; m="$(mem_disponivel_kb)"
  if [ -n "$m" ] && [ ! -f "$ESTADO/ram_antes.txt" ]; then
    echo "$m" > "$ESTADO/ram_antes.txt"
    info "RAM disponível ANTES das mudanças registrada: $((m/1024)) MB"
  fi
  ok "Salvo em $arq"
}

# --- backup ------------------------------------------------------------------
cmd_backup() {
  titulo "Backup do estado atual ($ALVO)"
  local arq="$SAIDA/backup_$DATA.txt"
  explicar "Lista todos os pacotes com o caminho do APK" "pm list packages -f"
  explicar "Lista pacotes já desativados e os instalados por você" "pm list packages -d / -3"
  explicar "Copia todas as configurações (global, secure, system)" "settings list global|secure|system"
  explicar "Registra launcher e teclado atuais e as propriedades do sistema" "cmd package resolve-activity ... HOME; getprop"
  {
    echo "### BACKUP tvopt — $DATA — $ALVO"
    echo "### Modelo: $(sh_ getprop ro.product.model)  Android $(sh_ getprop ro.build.version.release)"
    echo "### Launcher atual: $(launcher_atual)"
    echo "### Teclado atual : $(sh_ settings get secure default_input_method)"
    echo; echo "### pm list packages -f"; sh_ pm list packages -f | sort
    echo; echo "### pm list packages -d (desativados)"; sh_ pm list packages -d | sort
    echo; echo "### pm list packages -3 (instalados pelo usuário)"; sh_ pm list packages -3 | sort
    echo; echo "### settings list global"; sh_ settings list global
    echo; echo "### settings list secure"; sh_ settings list secure
    echo; echo "### settings list system"; sh_ settings list system
    echo; echo "### getprop"; sh_ getprop
  } > "$arq"
  # guarda valores originais das animações (para o desfazer)
  if [ ! -f "$ESTADO/animacoes_originais.txt" ]; then
    for k in window_animation_scale transition_animation_scale animator_duration_scale; do
      echo "$k=$(sh_ settings get global "$k")"
    done > "$ESTADO/animacoes_originais.txt"
  fi
  [ -f "$ESTADO/launcher_original.txt" ] || launcher_atual > "$ESTADO/launcher_original.txt"
  ok "Backup salvo em $arq ($(wc -l < "$arq") linhas)"
}

# --- 3. classificar ----------------------------------------------------------
cmd_classificar() {
  titulo "Classificação dos apps instalados ($ALVO)"
  explicar "Lê a lista de pacotes e compara com config/*.txt" "pm list packages / pm list packages -3 / -d"
  carregar_protecao_dinamica
  local arq="$SAIDA/classificacao_$DATA.txt"
  local todos usuario off bloat launchers
  todos="$(pacotes_todos)"; usuario="$(pacotes_usuario)"; off="$(pacotes_off)"
  bloat="$(lista_config bloat_seguro.txt)"; launchers="$(lista_config launchers_anuncio.txt)"

  local -a ess=() blo=() lan=() duv=() usu=()
  local p motivo st
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    st=""; printf '%s\n' "$off" | grep -qx "$p" && st=" [já desativado]"
    if motivo="$(protegido "$p")"; then
      ess+=("$p$st  ($motivo)")
    elif printf '%s\n' "$launchers" | grep -qx "$p"; then
      lan+=("$p$st  ($(descricao_config launchers_anuncio.txt "$p"))")
    elif printf '%s\n' "$bloat" | grep -qx "$p"; then
      blo+=("$p$st  ($(descricao_config bloat_seguro.txt "$p"))")
    elif printf '%s\n' "$usuario" | grep -qx "$p"; then
      usu+=("$p$st")
    else
      duv+=("$p$st")
    fi
  done <<< "$todos"

  {
    echo "Classificação — $DATA — $ALVO ($(sh_ getprop ro.product.model))"
    echo "Launcher em uso: ${PROT_LAUNCHER:-?}   Teclado em uso: ${PROT_TECLADO:-?}"
    echo
    echo "=== ESSENCIAL / PROTEGIDO (nunca será alterado) — ${#ess[@]} ==="
    printf '  %s\n' "${ess[@]}"
    echo
    echo "=== BLOATWARE SEGURO DE DESATIVAR — ${#blo[@]} ==="
    [ ${#blo[@]} -gt 0 ] && printf '  %s\n' "${blo[@]}"
    echo
    echo "=== LAUNCHERS COM ANÚNCIO (só após instalar outro launcher, etapa 5) — ${#lan[@]} ==="
    [ ${#lan[@]} -gt 0 ] && printf '  %s\n' "${lan[@]}"
    echo
    echo "=== SEUS APPS (instalados por você — não mexemos) — ${#usu[@]} ==="
    [ ${#usu[@]} -gt 0 ] && printf '  %s\n' "${usu[@]}"
    echo
    echo "=== DÚVIDA (apps de sistema não classificados — pergunte antes!) — ${#duv[@]} ==="
    [ ${#duv[@]} -gt 0 ] && printf '  %s\n' "${duv[@]}"
    echo
    echo "Para desativar algo da lista DÚVIDA depois de pesquisar/confirmar:"
    echo "  ./tvopt.sh $ALVO desativar <pacote> [<pacote> ...]"
  } | tee "$arq"
  ok "Salvo em $arq"
}

# --- 4. desativar ------------------------------------------------------------
desativar_um() { # desativar_um <pacote> <modo: disable|uninstall>
  local p="$1" modo="$2"
  if [ "$modo" = "uninstall" ]; then
    explicar "Remove $p só para o usuário 0 mantendo o APK no sistema (reversível com install-existing)" "pm uninstall -k --user 0 $p"
    if alterar pm uninstall -k --user 0 "$p"; then registrar "UNINSTALL|$p"; ok "$p removido (usuário 0)"; else erro "Falhou: $p"; fi
  else
    explicar "Desativa $p para o usuário 0 (reversível com pm enable)" "pm disable-user --user 0 $p"
    if alterar pm disable-user --user 0 "$p"; then registrar "DISABLE|$p"; ok "$p desativado"; else erro "Falhou: $p"; fi
  fi
}

cmd_desativar() {
  local modo="disable"; local -a extras=()
  for x in "$@"; do
    case "$x" in
      --remover) modo="uninstall" ;;
      *) extras+=("$x") ;;
    esac
  done
  titulo "Desativar bloatware ($ALVO)"
  exigir_backup
  carregar_protecao_dinamica
  local ativos; ativos="$(pacotes_ativos)"
  local -a cand=()
  local p motivo
  if [ ${#extras[@]} -gt 0 ]; then
    for p in "${extras[@]}"; do
      if motivo="$(protegido "$p")"; then aviso "RECUSADO: $p ($motivo)"; continue; fi
      printf '%s\n' "$ativos" | grep -qx "$p" || { aviso "Ignorado: $p não está instalado/ativo"; continue; }
      cand+=("$p")
    done
  else
    while IFS= read -r p; do
      printf '%s\n' "$ativos" | grep -qx "$p" || continue
      if motivo="$(protegido "$p")"; then aviso "Pulado: $p ($motivo)"; continue; fi
      cand+=("$p")
    done < <(lista_config bloat_seguro.txt)
  fi

  if [ ${#cand[@]} -eq 0 ]; then ok "Nada para desativar."; return 0; fi
  echo; info "Candidatos (${#cand[@]}), modo: $([ "$modo" = uninstall ] && echo 'pm uninstall -k --user 0' || echo 'pm disable-user --user 0'):"
  for p in "${cand[@]}"; do printf '   - %-50s %s\n' "$p" "$(descricao_config bloat_seguro.txt "$p")"; done
  echo
  local r="n"
  if [ "$SIM" = "1" ]; then r="t"
  else read -r -p "Desativar [t]odos, perguntar [u]m por um, ou [n]ão? " r </dev/tty || r="n"; fi
  case "$r" in
    t|T) for p in "${cand[@]}"; do desativar_um "$p" "$modo"; done ;;
    u|U) for p in "${cand[@]}"; do confirmar "Desativar $p?" && desativar_um "$p" "$modo"; done ;;
    *)   info "Nenhuma alteração feita." ;;
  esac
}

# --- 5. launcher -------------------------------------------------------------
PROJECTIVY="com.spocky.projengmenu"

cmd_launcher() {
  titulo "Launcher leve ($ALVO)"
  exigir_backup
  local apk="${1:-}" pkg="${2:-$PROJECTIVY}"
  if [ -n "$apk" ]; then
    [ -f "$apk" ] || morrer "APK não encontrado: $apk"
    explicar "Instala o APK do launcher a partir do PC" "adb install -r \"$apk\""
    confirmar "Instalar $apk?" || return 0
    if [ "$SIMULAR" = "1" ]; then echo "     [SIMULAÇÃO] adb install -r $apk"; else a install -r "$apk" || morrer "Falha na instalação."; fi
    # descobre o pacote do APK recém-instalado, se possível
    if command -v aapt >/dev/null 2>&1; then pkg="$(aapt dump badging "$apk" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")"; fi
  fi

  if ! instalado "$pkg"; then
    aviso "$pkg não está instalado."
    explicar "Abre a página do Projectivy Launcher na Play Store da TV" "am start -a android.intent.action.VIEW -d market://details?id=$pkg"
    if confirmar "Abrir a Play Store no aparelho para instalar?"; then
      alterar am start -a android.intent.action.VIEW -d "market://details?id=$pkg" >/dev/null
      info "Instale pela TV e rode novamente:  ./tvopt.sh $ALVO launcher"
      info "Sem Play Store? Baixe o APK no PC e rode:  ./tvopt.sh $ALVO launcher caminho/do/arquivo.apk"
    fi
    return 0
  fi

  local atual alvo
  atual="$(launcher_atual)"
  alvo="$(launchers_disponiveis | grep "^$pkg/" | head -n1)"
  info "Launcher atual: ${atual:-desconhecido}"
  if [ -z "$alvo" ]; then
    aviso "Não encontrei uma atividade HOME em $pkg. Abra o app uma vez na TV e tente de novo,"
    aviso "ou defina manualmente: Configurações > Apps > Apps padrão > Tela inicial."
    return 1
  fi

  if [ "${atual%%/*}" != "$pkg" ]; then
    explicar "Define $alvo como tela inicial padrão (reversível)" "cmd package set-home-activity $alvo"
    if confirmar "Definir $pkg como launcher padrão?"; then
      if alterar cmd package set-home-activity "$alvo"; then
        registrar "HOME|$alvo|$atual"; ok "Launcher padrão definido."
        explicar "Simula o botão HOME para testar" "input keyevent KEYCODE_HOME"
        alterar input keyevent KEYCODE_HOME >/dev/null
      else
        aviso "set-home-activity não funcionou neste Android. Pressione HOME no controle e escolha '$pkg' > 'Sempre'."
        return 1
      fi
    else
      return 0
    fi
  else
    ok "$pkg já é o launcher padrão."
  fi

  # Confere se o HOME realmente mudou antes de mexer nos launchers antigos
  [ "$SIMULAR" = "1" ] || sleep 2
  carregar_protecao_dinamica
  if [ "$SIMULAR" != "1" ] && [ "$PROT_LAUNCHER" != "$pkg" ]; then
    aviso "O launcher em uso ainda é '$PROT_LAUNCHER'. Não vou desativar launchers antigos."
    aviso "Pressione HOME no controle, escolha $pkg > 'Sempre' e rode esta etapa de novo."
    return 0
  fi

  titulo "Launchers antigos / com anúncios"
  local ativos; ativos="$(pacotes_ativos)"
  local conhecidos; conhecidos="$(lista_config launchers_anuncio.txt)"
  local p comp motivo
  local -a vistos=()
  while IFS= read -r comp; do
    p="${comp%%/*}"; [ -z "$p" ] || [ "$p" = "$pkg" ] && continue
    [[ " ${vistos[*]-} " == *" $p "* ]] && continue; vistos+=("$p")
    printf '%s\n' "$ativos" | grep -qx "$p" || continue
    if printf '%s\n' "$conhecidos" | grep -qx "$p"; then
      motivo="$(protegido "$p" 1)" && { aviso "Pulado: $p ($motivo)"; continue; }
      info "$p — $(descricao_config launchers_anuncio.txt "$p")"
      aviso "Dica: no Google TV, ative em Projectivy > Configurações > 'Substituir botão Home' antes de desativar."
      confirmar "Desativar $p?" && desativar_um "$p" disable
    else
      if motivo="$(protegido "$p")"; then info "Mantido: $p ($motivo)"; continue; fi
      aviso "DÚVIDA: $p também é um launcher, mas não está na lista conhecida."
      confirmar "Você tem certeza de que quer desativar $p?" && desativar_um "$p" disable
    fi
  done < <(launchers_disponiveis)

  titulo "Apps sugeridos"
  cat <<EOF
  - SmartTube (YouTube sem anúncios)  -> https://smarttubeapp.github.io  (instalar APK: adb -s $ALVO install arquivo.apk)
  - Kodi (mídia/IPTV)                 -> Play Store ou https://kodi.tv/download/android
  - TV Bro (navegador leve p/ controle) -> Play Store: com.phlox.tvwebbrowser
  - X-plore File Manager              -> Play Store: com.lonelycatgames.Xplore
  - Send Files to TV (enviar APKs do celular) -> Play Store
  Instale com: ./tvopt.sh $ALVO instalar <arquivo.apk>
EOF
}

cmd_instalar() {
  [ $# -ge 1 ] || morrer "Uso: ./tvopt.sh <IP> instalar arquivo.apk [...]"
  local f
  for f in "$@"; do
    [ -f "$f" ] || { erro "Não encontrado: $f"; continue; }
    explicar "Instala o APK no aparelho" "adb install -r \"$f\""
    if [ "$SIMULAR" = "1" ]; then echo "     [SIMULAÇÃO] adb install -r $f"; else a install -r "$f"; fi
  done
}

# --- 6. desempenho -----------------------------------------------------------
setting_mudar() { # setting_mudar <namespace> <chave> <valor>
  local ns="$1" k="$2" v="$3" antigo
  antigo="$(sh_ settings get "$ns" "$k")"
  if [ "$antigo" = "$v" ]; then ok "$ns/$k já é $v"; return 0; fi
  explicar "Altera $ns/$k de '$antigo' para '$v'" "settings put $ns $k $v"
  if alterar settings put "$ns" "$k" "$v"; then registrar "SETTING|$ns|$k|$antigo|$v"; ok "$k = $v"; fi
}

cmd_desempenho() {
  titulo "Ajustes de desempenho ($ALVO)"
  exigir_backup
  carregar_protecao_dinamica

  info "1) Escalas de animação em 0.5x (menus parecem mais rápidos)"
  if confirmar "Aplicar animações 0.5x?"; then
    setting_mudar global window_animation_scale 0.5
    setting_mudar global transition_animation_scale 0.5
    setting_mudar global animator_duration_scale 0.5
  fi

  echo
  info "2) Impedir que apps rodem/iniciem sozinhos em segundo plano"
  info "   Usa 'cmd appops set <app> RUN_IN_BACKGROUND ignore' (Android 8+). O app continua abrindo normalmente;"
  info "   só não fica rodando escondido. NÃO restrinja: launcher, teclado, apps de IPTV que gravam, Kodi se usa add-ons de servidor."
  local sdk; sdk="$(android_sdk)"; sdk="${sdk:-0}"
  if [ "$sdk" -lt 26 ]; then
    aviso "Android antigo (SDK $sdk): appops RUN_IN_BACKGROUND não é suportado. Pulando."
  else
    local p motivo antigo op
    while IFS= read -r p; do
      [ -z "$p" ] && continue
      motivo="$(protegido "$p")" && continue
      antigo="$(sh_ cmd appops get "$p" RUN_IN_BACKGROUND | sed -n 's/^RUN_IN_BACKGROUND: \([a-z]*\).*/\1/p' | head -n1)"
      antigo="${antigo:-default}"
      [ "$antigo" = "ignore" ] && continue
      if confirmar "Restringir segundo plano de $p (atual: $antigo)?"; then
        for op in RUN_IN_BACKGROUND RUN_ANY_IN_BACKGROUND; do
          [ "$op" = RUN_ANY_IN_BACKGROUND ] && [ "$sdk" -lt 28 ] && continue
          antigo="$(sh_ cmd appops get "$p" "$op" | sed -n "s/^$op: \([a-z]*\).*/\1/p" | head -n1)"; antigo="${antigo:-default}"
          explicar "Bloqueia $op para $p" "cmd appops set $p $op ignore"
          alterar cmd appops set "$p" "$op" ignore && registrar "APPOPS|$p|$op|$antigo|ignore"
        done
      fi
    done < <(pacotes_usuario)
  fi

  echo
  info "3) Limpar cache de todos os apps (não apaga logins nem dados)"
  explicar "Pede ao sistema para liberar todo o cache possível" "pm trim-caches 999G"
  if confirmar "Limpar cache agora?"; then
    local antes depois
    antes="$(sh_ df /data | awk 'NR==2{print $4}')"
    alterar pm trim-caches 999G
    depois="$(sh_ df /data | awk 'NR==2{print $4}')"
    info "Espaço livre em /data: antes=$antes  depois=$depois"
  fi

  echo
  info "4) Limite de processos em segundo plano"
  aviso "Essa opção NÃO pode ser definida de forma confiável por ADB e volta ao padrão a cada reinício."
  aviso "Se quiser: Configurações > Opções do desenvolvedor > 'Limite de processos em segundo plano' > 'No máximo 2 processos'."
  aviso "Em aparelhos com 1–2 GB de RAM isso ajuda; com 4 GB+ normalmente não vale a pena (apps recarregam toda hora)."
  echo
  info "5) Encerrar apps que estão rodando agora em segundo plano (não altera nada permanente)"
  explicar "Mata processos em cache que não estão em uso" "am kill-all"
  confirmar "Executar am kill-all?" && alterar am kill-all
}

# --- 7. hy300 ----------------------------------------------------------------
cmd_hy300() {
  titulo "Diagnóstico do projetor HY300 ($ALVO)"
  local arq="$SAIDA/hy300_$DATA.txt"
  explicar "Resolução lógica que o Android usa para desenhar a tela" "wm size; wm density"
  explicar "Modos de exibição reais do painel / saída" "dumpsys display"
  explicar "Procura apps de keystone/foco/correção de imagem" "pm list packages | grep keystone|focus|projector..."
  explicar "Versão do firmware e apps de atualização (OTA)" "getprop ro.build.*; pm list packages | grep update|ota"
  {
    echo "HY300 — $DATA — $ALVO"
    echo "Modelo: $(sh_ getprop ro.product.model)  Plataforma: $(sh_ getprop ro.board.platform)  Android $(sh_ getprop ro.build.version.release)"
    echo
    echo "=== Resolução ==="
    echo "wm size   : $(sh_ wm size | tr '\n' ' ')"
    echo "wm density: $(sh_ wm density | tr '\n' ' ')"
    echo "--- dumpsys display (modos) ---"
    sh_ dumpsys display | grep -iE 'mDisplayInfos|DisplayModeRecord|mActiveModeId|real [0-9]+ x [0-9]+|width=|fps=' | head -n 20
    echo "--- Allwinner: atributos do driver de vídeo (se disponível) ---"
    sh_ cat /sys/class/disp/disp/attr/sys 2>/dev/null | head -n 15
    sh_ getprop | grep -iE 'display|hdmi|resolution|lcd|panel' | head -n 20
    echo
    echo "=== Keystone / Foco / Correção ==="
    pacotes_todos | grep -iE 'keystone|trapez|focus|correct|projector|projection|softwinner|allwinner' | sed 's/^/  /'
    echo "  (Todos acima estão PROTEGIDOS pelo tvopt e nunca serão desativados.)"
    sh_ settings list global | grep -iE 'keystone|focus|trapez|project' | sed 's/^/  global: /'
    sh_ settings list system | grep -iE 'keystone|focus|trapez|project' | sed 's/^/  system: /'
    echo
    echo "=== Firmware / Atualização ==="
    echo "Fingerprint: $(sh_ getprop ro.build.fingerprint)"
    echo "Build      : $(sh_ getprop ro.build.display.id)"
    echo "Data build : $(sh_ getprop ro.build.date)"
    echo "Patch seg. : $(sh_ getprop ro.build.version.security_patch)"
    echo "Apps de atualização encontrados:"
    pacotes_todos | grep -iE 'update|ota|fota|upgrade' | sed 's/^/  /'
  } | tee "$arq"
  cat <<'EOF'

LEITURA DOS RESULTADOS
- Resolução: o HY300 tem painel NATIVO 1280x720 (720p), mesmo anunciado como "4K". Se "wm size" mostrar
  1920x1080 ou mais, o projetor está reduzindo a imagem — normal; o que vale é o painel. Não altere "wm size".
- Keystone/foco: normalmente em Configurações > Projeção / "Keystone" / "Correção de imagem". Se tiver
  correção automática, use; manual com 4 pontos dá imagem mais nítida que a correção digital forte
  (keystone digital reduz a resolução efetiva — prefira posicionar o projetor reto).
- Atualização: se houver app de "Atualização do sistema" listado acima (que NÃO seja Adups), abra-o pela TV.
  Firmware só da fonte oficial do vendedor/fabricante, nunca de fóruns. Este projeto não instala firmware.
EOF
  local ota
  ota="$(pacotes_todos | grep -iE 'update|ota|upgrade' | grep -viE 'adups|webview|gms|vending' | head -n1)"
  if [ -n "$ota" ] && confirmar "Abrir o app de atualização '$ota' na tela do projetor?"; then
    explicar "Abre o app de atualização oficial" "monkey -p $ota -c android.intent.category.LAUNCHER 1"
    alterar monkey -p "$ota" -c android.intent.category.LAUNCHER 1 >/dev/null
  fi
  ok "Salvo em $arq"
}

# --- 8. gerar scripts / desfazer --------------------------------------------
cmd_gerar_scripts() {
  titulo "Gerando scripts de reaplicar e desfazer ($ALVO)"
  [ -s "$LOG" ] || { aviso "Nenhuma alteração registrada em $LOG ainda."; return 0; }
  local base="${ALVO//[:.]/_}"
  local rs="$SAIDA/reaplicar_$base.sh" ds="$SAIDA/desfazer_$base.sh"
  local rb="$SAIDA/reaplicar_$base.bat" db="$SAIDA/desfazer_$base.bat"
  local tipo x y z w

  { echo '#!/usr/bin/env bash'; echo "# Reaplica as otimizações do tvopt em $ALVO (gerado $DATA)"
    echo "T=\"\${1:-$ALVO}\"; adb connect \"\$T\""; echo 'A() { adb -s "$T" shell "$@"; }'; } > "$rs"
  { echo '#!/usr/bin/env bash'; echo "# DESFAZ as otimizações do tvopt em $ALVO (gerado $DATA)"
    echo "T=\"\${1:-$ALVO}\"; adb connect \"\$T\""; echo 'A() { adb -s "$T" shell "$@"; }'; } > "$ds"
  { echo '@echo off'; echo "REM Reaplica as otimizacoes do tvopt em $ALVO (gerado $DATA)"
    echo "set T=%1"; echo "if \"%T%\"==\"\" set T=$ALVO"; echo 'adb connect %T%'; } > "$rb"
  { echo '@echo off'; echo "REM DESFAZ as otimizacoes do tvopt em $ALVO (gerado $DATA)"
    echo "set T=%1"; echo "if \"%T%\"==\"\" set T=$ALVO"; echo 'adb connect %T%'; } > "$db"

  # reaplicar: ordem original
  while IFS='|' read -r tipo x y z w; do
    case "$tipo" in
      DISABLE)   echo "A pm disable-user --user 0 $x" >> "$rs"; echo "adb -s %T% shell pm disable-user --user 0 $x" >> "$rb" ;;
      UNINSTALL) echo "A pm uninstall -k --user 0 $x" >> "$rs"; echo "adb -s %T% shell pm uninstall -k --user 0 $x" >> "$rb" ;;
      SETTING)   echo "A settings put $x $y $w" >> "$rs"; echo "adb -s %T% shell settings put $x $y $w" >> "$rb" ;;
      APPOPS)    echo "A cmd appops set $x $y $w" >> "$rs"; echo "adb -s %T% shell cmd appops set $x $y $w" >> "$rb" ;;
      HOME)      echo "A cmd package set-home-activity '$x'" >> "$rs"; echo "adb -s %T% shell cmd package set-home-activity \"$x\"" >> "$rb" ;;
      INSTALL)   echo "# $x foi instalado pelo painel: instale de novo pela aba 'Instalar apps'" >> "$rs"; echo "REM $x foi instalado pelo painel: instale de novo pela aba Instalar apps" >> "$rb" ;;
    esac
  done < "$LOG"

  # desfazer: ordem inversa
  while IFS='|' read -r tipo x y z w; do
    case "$tipo" in
      DISABLE)   echo "A pm enable --user 0 $x" >> "$ds"; echo "adb -s %T% shell pm enable --user 0 $x" >> "$db" ;;
      UNINSTALL) echo "A cmd package install-existing $x" >> "$ds"; echo "adb -s %T% shell cmd package install-existing $x" >> "$db" ;;
      SETTING)   if [ "$z" = "null" ] || [ -z "$z" ]; then
                   echo "A settings delete $x $y" >> "$ds"; echo "adb -s %T% shell settings delete $x $y" >> "$db"
                 else
                   echo "A settings put $x $y $z" >> "$ds"; echo "adb -s %T% shell settings put $x $y $z" >> "$db"
                 fi ;;
      APPOPS)    echo "A cmd appops set $x $y $z" >> "$ds"; echo "adb -s %T% shell cmd appops set $x $y $z" >> "$db" ;;
      HOME)      [ -n "$y" ] && { echo "A cmd package set-home-activity '$y'" >> "$ds"; echo "adb -s %T% shell cmd package set-home-activity \"$y\"" >> "$db"; } ;;
      INSTALL)   echo "A pm uninstall $x" >> "$ds"; echo "adb -s %T% shell pm uninstall $x" >> "$db" ;;
    esac
  done < <(tac "$LOG" 2>/dev/null || tail -r "$LOG")

  echo 'echo "Concluído."' >> "$rs"; echo 'echo "Concluído. Reinicie o aparelho se algo não voltar de imediato."' >> "$ds"
  echo 'echo Concluido.' >> "$rb"; echo 'echo Concluido. Reinicie o aparelho se algo nao voltar de imediato.' >> "$db"
  echo 'pause' >> "$rb"; echo 'pause' >> "$db"
  # .bat precisa de CRLF
  sed -i 's/$/\r/' "$rb" "$db" 2>/dev/null || true
  chmod +x "$rs" "$ds"
  ok "Gerados:"; printf '   %s\n' "$rs" "$ds" "$rb" "$db"
}

cmd_desfazer() {
  titulo "DESFAZER todas as alterações registradas ($ALVO)"
  [ -s "$LOG" ] || { ok "Nada registrado para desfazer."; return 0; }
  info "Alterações registradas: $(wc -l < "$LOG")"
  confirmar "Desfazer TUDO em $ALVO?" || return 0
  local tipo x y z w
  while IFS='|' read -r tipo x y z w; do
    case "$tipo" in
      DISABLE)   explicar "Reativa $x" "pm enable --user 0 $x"; alterar pm enable --user 0 "$x" ;;
      UNINSTALL) explicar "Reinstala $x a partir do APK do sistema" "cmd package install-existing $x"; alterar cmd package install-existing "$x" ;;
      SETTING)   if [ "$z" = "null" ] || [ -z "$z" ]; then explicar "Remove $x/$y (volta ao padrão)" "settings delete $x $y"; alterar settings delete "$x" "$y"
                 else explicar "Restaura $x/$y=$z" "settings put $x $y $z"; alterar settings put "$x" "$y" "$z"; fi ;;
      APPOPS)    explicar "Restaura $y de $x para $z" "cmd appops set $x $y $z"; alterar cmd appops set "$x" "$y" "$z" ;;
      HOME)      [ -n "$y" ] && { explicar "Restaura o launcher original" "cmd package set-home-activity $y"; alterar cmd package set-home-activity "$y"; } ;;
      INSTALL)   explicar "Desinstala $x (instalado pelo painel)" "pm uninstall $x"; alterar pm uninstall "$x" ;;
    esac
  done < <(tac "$LOG" 2>/dev/null || tail -r "$LOG")
  if [ "$SIMULAR" != "1" ]; then mv "$LOG" "$ESTADO/alteracoes_desfeitas_$DATA.log"; fi
  ok "Tudo desfeito. Histórico guardado em $ESTADO/alteracoes_desfeitas_$DATA.log"
}

# --- 9. resumo ---------------------------------------------------------------
cmd_resumo() {
  titulo "Resumo ($ALVO)"
  local arq="$SAIDA/resumo_$DATA.txt"
  local antes depois
  antes="$(cat "$ESTADO/ram_antes.txt" 2>/dev/null)"
  explicar "Mede a RAM disponível agora" "cat /proc/meminfo | grep MemAvailable"
  depois="$(mem_disponivel_kb)"
  {
    echo "Resumo tvopt — $DATA — $ALVO ($(sh_ getprop ro.product.model), Android $(sh_ getprop ro.build.version.release))"
    echo
    echo "=== RAM disponível ==="
    if [ -n "$antes" ] && [ -n "$depois" ]; then
      echo "Antes : $((antes/1024)) MB"
      echo "Depois: $((depois/1024)) MB   (diferença: $(((depois-antes)/1024)) MB)"
      echo "Obs.: compare de preferência após reiniciar o aparelho e esperar 2 min nos dois casos."
    else
      echo "Atual: $(( ${depois:-0}/1024 )) MB (sem medição 'antes' — rode 'info' antes das mudanças)"
    fi
    echo
    echo "=== O que mudou ==="
    if [ -s "$LOG" ]; then
      echo "Apps desativados : $(grep -c '^DISABLE|' "$LOG")";   grep '^DISABLE|' "$LOG" | cut -d'|' -f2 | sed 's/^/   - /'
      echo "Apps removidos (user 0): $(grep -c '^UNINSTALL|' "$LOG")"; grep '^UNINSTALL|' "$LOG" | cut -d'|' -f2 | sed 's/^/   - /'
      echo "Configurações    :"; grep '^SETTING|' "$LOG" | awk -F'|' '{printf "   - %s/%s: %s -> %s\n",$2,$3,$4,$5}'
      echo "Segundo plano    :"; grep '^APPOPS|' "$LOG" | awk -F'|' '{printf "   - %s %s -> %s\n",$2,$3,$5}'
      echo "Launcher         :"; grep '^HOME|' "$LOG" | awk -F'|' '{printf "   - %s (antes: %s)\n",$2,$3}'
    else
      echo "Nenhuma alteração registrada."
    fi
    echo
    echo "=== Próximos passos ==="
    echo " 1. Reinicie o aparelho (adb -s $ALVO reboot) e use por alguns dias."
    echo " 2. Se algo parar de funcionar: ./tvopt.sh $ALVO desfazer  (ou o desfazer_*.bat/.sh gerado)."
    echo " 3. Revise a lista DÚVIDA da classificação; pesquise cada pacote antes de desativar."
    echo " 4. Após atualização de firmware, rode 'reaplicar' — atualizações podem reativar apps."
    echo " 5. Mantenha SmartTube/Kodi atualizados; desative 'Fontes desconhecidas' depois de instalar APKs."
  } | tee "$arq"
  ok "Salvo em $arq"
}

# --- tudo (fluxo guiado) -----------------------------------------------------
cmd_tudo() {
  cmd_info; cmd_backup; cmd_classificar
  echo; confirmar "Seguir para a etapa 4 (desativar bloatware)?" && cmd_desativar
  echo; confirmar "Seguir para a etapa 5 (launcher leve)?" && cmd_launcher
  echo; confirmar "Seguir para a etapa 6 (desempenho)?" && cmd_desempenho
  echo; confirmar "Este aparelho é o projetor HY300 (etapa 7)?" && cmd_hy300
  cmd_gerar_scripts; cmd_resumo
}

ajuda() {
  cat <<EOF
tvopt.sh — otimização segura de Android TV via ADB (sem root)

Uso: ./tvopt.sh <IP[:porta]> <comando> [opções]

Comandos (na ordem recomendada):
  info                  2. Coleta modelo, Android, chip, RAM e armazenamento
  backup                   Salva lista de pacotes e configurações em saida/<ip>/backup_<data>.txt
  classificar           3. Classifica apps: essencial / bloatware seguro / launcher c/ anúncio / dúvida
  desativar [--remover] [pacotes...]
                        4. Desativa o bloatware seguro (ou só os pacotes informados), com confirmação.
                           --remover usa 'pm uninstall -k --user 0' em vez de 'pm disable-user'
  launcher [arquivo.apk] [pacote]
                        5. Instala/define launcher leve (padrão: Projectivy) e oferece desativar o antigo
  instalar <apk...>        Instala APKs (SmartTube, Kodi...)
  desempenho            6. Animações 0.5x, restringir segundo plano, limpar cache
  hy300                 7. Diagnóstico do projetor: resolução real, keystone/foco, atualização
  gerar-scripts         8. Gera reaplicar_*.sh/.bat e desfazer_*.sh/.bat a partir do que foi feito
  desfazer                 Desfaz TODAS as alterações registradas
  resumo                9. RAM antes/depois, o que mudou e próximos passos
  tudo                     Fluxo guiado com todas as etapas (pede OK em cada uma)

Variáveis: SIMULAR=1 (só mostra o que faria)   SIM=1 (aceita todas as confirmações)
Exemplo:   ./tvopt.sh 192.168.0.50 info
           SIMULAR=1 ./tvopt.sh 192.168.0.50 desativar
EOF
}

# =============================================================================
main() {
  if [ $# -lt 1 ] || [[ "$1" =~ ^(-h|--help|ajuda|help)$ ]]; then ajuda; exit 0; fi
  [ $# -ge 2 ] || { ajuda; exit 1; }
  preparar_alvo "$1"; local c="$2"; shift 2
  [ "$SIMULAR" = "1" ] && aviso "MODO SIMULAÇÃO: nenhuma alteração será feita."
  conectar
  case "$c" in
    info)           cmd_info ;;
    backup)         cmd_backup ;;
    classificar)    cmd_classificar ;;
    desativar)      cmd_desativar "$@" ;;
    launcher)       cmd_launcher "$@" ;;
    instalar)       cmd_instalar "$@" ;;
    desempenho)     cmd_desempenho ;;
    hy300)          cmd_hy300 ;;
    gerar-scripts)  cmd_gerar_scripts ;;
    desfazer)       cmd_desfazer ;;
    resumo)         cmd_resumo ;;
    tudo)           cmd_tudo ;;
    *) erro "Comando desconhecido: $c"; ajuda; exit 1 ;;
  esac
}
main "$@"
