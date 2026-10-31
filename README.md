# Tvbuild — Otimização segura de TV box e projetor Android

Deixa TV box Android e o projetor **HY300** (Allwinner) mais rápidos, **sem anúncios** e com interface limpa para streaming (YouTube, Netflix, IPTV/Kodi). Tudo roda no seu PC (Windows, Linux ou macOS) e fala com a TV pela rede usando ADB, sem root.

- **Painel no navegador:** classifica e desativa bloatware, troca o launcher, instala apps sem usar o controle, ajusta o desempenho e desfaz qualquer coisa com um clique.
- **Controle remoto no celular:** direcional, volume, atalhos dos apps, digitar na TV e ver a tela.
- **Linha de comando** (`tvopt.sh`) para quem prefere terminal, com as mesmas regras e o mesmo histórico.

> **Regras de segurança do projeto**
> - Nada de root, flash de firmware ou bootloader.
> - Só alterações reversíveis: `pm disable-user --user 0` ou `pm uninstall -k --user 0`. Nenhuma partição é apagada.
> - **Backup automático antes da primeira alteração:** lista de pacotes (`pm list packages -f`) e todas as configurações, num `.txt` com data.
> - **Nunca são alterados:** o launcher em uso, o teclado, Wi-Fi, Bluetooth, Configurações, SystemUI, Google Play Services, HDMI/CEC, nem keystone/foco do projetor. A lista fica em [`config/protegidos.txt`](config/protegidos.txt), e o painel recusa esses pacotes mesmo que você peça. Se a TV não tiver uma tela inicial padrão definida, **todas** as telas iniciais ficam protegidas.
> - Pacotes desconhecidos ficam na lista **Dúvida** e nunca são desativados sem você pedir pelo nome.
> - Antes de executar, o painel mostra **cada comando com uma explicação** e pede confirmação.
> - Toda alteração fica registrada e pode ser desfeita, uma por uma ou todas de uma vez.

---

## Início rápido (Windows)

1. Baixe o projeto: no GitHub, **Code → Download ZIP**, e extraia numa pasta.
2. Na TV, ative a depuração ADB (veja [Ativar o ADB na TV](#ativar-o-adb-na-tv)).
3. Dê dois cliques em **`iniciar-painel.bat`**.
   - Se faltar o **Node.js**, ele oferece instalar pelo `winget` (fonte oficial).
   - Se faltar o **adb**, ele oferece baixar o Platform Tools oficial do Google para a pasta do projeto.
4. O navegador abre o painel. Clique em **Procurar TVs na rede** (ou digite o IP da TV) e aceite **"Permitir depuração?"** na tela da TV.

Para usar também pelo celular (painel e controle remoto), abra pelo terminal com `iniciar-painel.bat --rede`.

**Linux / macOS:**
```bash
bash iniciar-painel.sh
```
Ele usa o `adb` do sistema (`sudo apt install adb`) ou oferece baixar o Platform Tools oficial. Precisa do Node.js 18 ou mais novo (`sudo apt install nodejs`).

Deixe a janela do painel aberta enquanto usa; fechar a janela fecha o painel. Não precisa de `npm install`: o painel não tem dependências.

---

## Ativar o ADB na TV

### TV box (Android TV / Google TV / box genérico)

1. **Configurações → Preferências do dispositivo → Sobre** (em box genérico: **Configurações → Sobre** ou **Sistema → Sobre**).
2. Vá até **Build / Número da versão** e aperte **OK 7 vezes** até aparecer "Você agora é um desenvolvedor".
3. Abra **Opções do desenvolvedor** e ative **Depuração USB** e, se existir, **Depuração ADB pela rede** (*Network debugging*).
4. Veja o IP em **Configurações → Rede e Internet → (sua rede Wi-Fi)**.
5. **Recomendado:** reserve esse IP no roteador (DHCP estático) para ele não mudar.

> Boxes genéricos (MXQ Pro, X96 etc.) muitas vezes já vêm com ADB em rede ligado na porta 5555.

### Projetor HY300 (Allwinner)

1. **Configurações → Sobre / About** → aperte **OK 7 vezes** em **Build number / Versão**.
2. **Configurações → Sistema → Opções do desenvolvedor** → ative **Depuração USB** e, se existir, **Depuração ADB pela rede**.
3. Algumas versões escondem as configurações do Android atrás do launcher próprio: procure **Mais configurações / Android Settings**.
4. O IP fica em **Configurações → Rede → Wi-Fi → (sua rede)**.

### Android 11+ só com "Depuração sem fio"

Se a TV só tiver **Depuração sem fio** (*Wireless debugging*), ela pede pareamento:

1. Na TV: **Depuração sem fio → Parear com código**. Anote o **IP:porta** e o **código de 6 números**.
2. No painel, na lateral: **Android 11+: parear com código**. Preencha e clique em **Parear**.
3. Adicione o aparelho com o **IP:porta da tela principal de "Depuração sem fio"**, que é outra porta.

Essa porta muda quando a TV reinicia. Se a conexão falhar depois de reiniciar, remova o aparelho e adicione com a porta nova.

---

## Painel

| Aba | O que faz |
|---|---|
| **Visão geral** | Modelo, Android, chip, RAM, armazenamento e um roteiro do que já foi feito. A primeira leitura grava a RAM "antes". |
| **Apps** | Classifica tudo em *Bloatware seguro / Dúvida / Launchers com anúncio / Seus apps / Essenciais*. Marque, clique em **Revisar e desativar** e confira os comandos. Itens da lista Dúvida exigem marcar "Pesquisei e tenho certeza". |
| **Launcher** | Instala o **Projectivy Launcher**, define como padrão e só então libera desativar o launcher antigo com anúncios. |
| **Instalar apps** | Instala SmartTube, Kodi, VLC, TV Bro e Projectivy **sem usar o controle**: busca a versão mais nova na fonte oficial, escolhe o arquivo certo para o processador da TV (arm64/armv7/x86), baixa no PC e instala, com barra de progresso. Também aceita link direto de `.apk` ou um APK do PC. Apps só da Play Store (Netflix, X-plore…) abrem na página certa na TV. |
| **Desempenho** | Animações 0.5x, bloquear apps que rodam sozinhos, limpar cache e liberar RAM. |
| **Projetor HY300** | Resolução real, keystone/foco e firmware, com botão para abrir o app de atualização oficial. Só aparece para aparelhos do tipo HY300. |
| **Histórico e desfazer** | RAM antes/agora, cada alteração com **Desfazer**, **Desfazer tudo**, **Gerar scripts reaplicar/desfazer** (.bat e .sh) e download de backups e relatórios. |

A barra **Atividade**, no rodapé, mostra cada comando executado e a resposta da TV.

### Detalhes das etapas

- **Desativar:** `pm disable-user --user 0 <pacote>` esconde e para o app; volta com `pm enable`. A opção **Remover para o usuário** usa `pm uninstall -k --user 0`: o APK continua no sistema e volta com `cmd package install-existing`.
- **Launcher:** usa `cmd package set-home-activity`. Se o seu Android não aceitar, aperte Início no controle, escolha Projectivy e depois **"Sempre"**. No **Google TV**, antes de desativar o launcher do Google, ative no Projectivy **Configurações → "Substituir botão Home"**.
- **Apps que iniciam sozinhos:** `cmd appops set <app> RUN_IN_BACKGROUND ignore` (Android 8+). O app abre normalmente, só não fica rodando escondido. Não use em apps de IPTV que gravam programas.
- **Limite de processos em segundo plano:** não é confiável por ADB e volta ao padrão a cada reinício. Se quiser, configure em *Opções do desenvolvedor → Limite de processos em segundo plano*. Só vale em aparelhos com 1 a 2 GB de RAM.
- **HY300:** o painel do projetor é **1280×720 nativo**, mesmo que a caixa diga "4K". Não altere `wm size`. Keystone digital forte reduz a nitidez: prefira alinhar o projetor fisicamente. Firmware só da fonte oficial; este projeto nunca instala firmware.
- **Instalar apps:** só aceita links `https`, limita o tamanho a 600 MB e confere se o arquivo é mesmo um APK. Os apps instalados entram no histórico e podem ser desinstalados pelo Desfazer. O catálogo fica em [`config/catalogo_apps.json`](config/catalogo_apps.json).

---

## Controle remoto no celular

Abra o painel com `--rede` (`iniciar-painel.bat --rede` ou `bash iniciar-painel.sh --rede`). A janela mostra dois links com código de acesso:

```
Painel no celular:   http://192.168.0.10:7311/#t=código
Controle remoto:     http://192.168.0.10:7311/controle#t=código
```

Abra o link do controle no celular, na mesma rede Wi-Fi, e use **"Adicionar à tela inicial"** para ele virar um ícone de app. O código fica salvo entre reinícios, para o atalho continuar funcionando. Para gerar outro (e invalidar o antigo), use `--novo-codigo`. No PC, o botão **Controle remoto** ao lado do nome do aparelho abre o mesmo controle.

- **Direcional + OK, Voltar, Início, Menu, volume, mudo e mídia.** Segure as setas e o volume para repetir.
- **Atalhos** dos apps instalados (SmartTube, Netflix, Kodi…) e Configurações.
- **Touchpad:** deslize para mover a seleção e toque para OK.
- **Digitar:** escreva no celular e o texto aparece na TV (senhas, buscas). Acentos e emojis não passam pelo ADB: “ção” vira “cao”.
- **Ver tela:** um print da TV a cada 2 segundos. Toque na imagem para tocar naquele ponto. Apps com proteção (Netflix, por exemplo) aparecem pretos.
- **Ligar/desligar** a tela (precisa de dois toques).
- No PC, as setas, Enter, Backspace, + e − do teclado também controlam a TV.

Os comandos levam de 0,1 a 0,3 s para chegar. É ótimo para navegar, mas não para jogar: para jogos, pareie um controle Bluetooth direto na TV.

Se o Windows perguntar sobre o firewall ao usar `--rede`, permita só em **redes privadas**.

---

## Linha de comando

Linux/macOS: `./tvopt.sh <IP> <comando>` (se baixou o ZIP, rode antes `chmod +x tvopt.sh`). Windows: `tvopt.bat <IP> <comando>` (precisa do Git for Windows).

| Etapa | Comando | Altera algo? |
|---|---|---|
| Informações | `./tvopt.sh 192.168.0.50 info` | Não |
| Backup | `./tvopt.sh 192.168.0.50 backup` | Não |
| Classificar apps | `./tvopt.sh 192.168.0.50 classificar` | Não |
| Desativar bloatware | `./tvopt.sh 192.168.0.50 desativar` | **Sim, com confirmação** |
| Desativar item da lista Dúvida | `./tvopt.sh 192.168.0.50 desativar com.exemplo.app` | **Sim, com confirmação** |
| Launcher leve | `./tvopt.sh 192.168.0.50 launcher` | **Sim, com confirmação** |
| Instalar APKs | `./tvopt.sh 192.168.0.50 instalar SmartTube.apk` | Sim |
| Desempenho | `./tvopt.sh 192.168.0.50 desempenho` | **Sim, com confirmação** |
| Diagnóstico HY300 | `./tvopt.sh 192.168.0.51 hy300` | Não |
| Gerar scripts reaplicar/desfazer | `./tvopt.sh 192.168.0.50 gerar-scripts` | Não |
| Desfazer tudo | `./tvopt.sh 192.168.0.50 desfazer` | Sim (reverte) |
| Resumo (RAM antes/depois) | `./tvopt.sh 192.168.0.50 resumo` | Não |
| Fluxo guiado completo | `./tvopt.sh 192.168.0.50 tudo` | Pergunta a cada etapa |

Para ver o que seria feito sem alterar nada:

```bash
SIMULAR=1 ./tvopt.sh 192.168.0.50 desativar
```

`windows/coletar_e_backup.bat` faz só a coleta de informações e o backup, sem Git Bash e sem alterar nada.

---

## Desfazer

- **Painel:** aba **Histórico e desfazer**, item por item ou tudo.
- **Linha de comando:** `./tvopt.sh <IP> desfazer`.
- **Sem o projeto à mão:** use o `desfazer_<ip>.bat` ou `.sh` gerado em `saida/<ip>/`.
- **Último recurso:** **Configurações → Restaurar padrões de fábrica** volta tudo, porque nada foi apagado do sistema.

Painel e linha de comando usam o mesmo registro (`saida/<ip>/estado/alteracoes.log`): o que um faz, o outro desfaz.

---

## Estrutura

```
iniciar-painel.bat / .sh      Abre o painel (instala Node.js/adb se faltar)
painel/server.js              Servidor local (Node.js, sem dependências)
painel/lib/                   ADB, operações, catálogo de apps e controle remoto
painel/public/                Interface do painel e do controle remoto
config/protegidos.txt         Pacotes que NUNCA são alterados (padrões regex)
config/bloat_seguro.txt       Bloatware conhecido e seguro de desativar
config/launchers_anuncio.txt  Launchers de fábrica com anúncios
config/catalogo_apps.json     Apps da aba "Instalar apps" (só fontes oficiais)
tvopt.sh / tvopt.bat          Linha de comando
windows/coletar_e_backup.bat  Informações + backup só com Windows
test/                         Testes automáticos (npm test)
saida/<ip>/                   Backups, relatórios e scripts gerados (fora do git)
platform-tools/               adb baixado pelo iniciar-painel (fora do git)
```

## Personalizar

- **Bloatware que você confirmou:** acrescente `pacote  # descrição` em `config/bloat_seguro.txt`.
- **Proteger mais coisas:** acrescente um padrão regex em `config/protegidos.txt`.
- **Outro app no catálogo:** acrescente uma entrada em `config/catalogo_apps.json` com a fonte oficial.
- **Outra porta:** `iniciar-painel.bat --porta 8080`.

## Solução de problemas

| Problema | Solução |
|---|---|
| **Não sei o IP da TV (ou estou sem o controle)** | No painel, clique em **Procurar TVs na rede**: ele acha as TVs com o ADB ligado na porta 5555 (muitas TV boxes já vêm assim) e adiciona com um clique. Se não achar: veja a lista de dispositivos na página do roteador (geralmente `192.168.0.1` ou `192.168.1.1`), use o app **Fing** no celular, ou ligue um mouse/teclado USB na TV box. |
| **"Aceite Permitir depuração"** / `unauthorized` | Aceite o aviso na TV, marcando "Sempre permitir". Se não aparecer, desligue e ligue a depuração na TV e tente de novo. |
| **Não conecta** | Confira o IP, se o PC e a TV estão na mesma rede e se a depuração em rede está ativa. No Android 11+, use o pareamento. |
| **Conectava e parou depois de reiniciar a TV** | Com "Depuração sem fio" a porta muda a cada reinício: adicione o aparelho com a porta nova. |
| **"adb não encontrado"** | Rode o `iniciar-painel.bat` e aceite baixar o Platform Tools, ou instale manualmente (https://developer.android.com/tools/releases/platform-tools). |
| **"A porta 7311 já está em uso"** | O painel já está aberto em outra janela. Use essa, ou inicie com `--porta 8080`. |
| **O celular não abre o painel** | Inicie com `--rede`, use o link com código mostrado na janela e permita o Node.js no firewall do Windows (redes privadas). |
| **A instalação de um app falhou** | A mensagem explica o motivo (Android antigo, falta de espaço, versão da Play Store já instalada…). Detalhes na barra Atividade. |
| **Um app sumiu e faz falta** | Aba Histórico → Desfazer no item. |
| **Tela inicial preta** | Histórico → Desfazer tudo. Sem o PC: **Configurações → Apps → mostrar apps do sistema → (launcher) → Ativar**. |

## Desenvolvimento

```bash
npm test
```

Os testes usam um adb simulado (`test/adb-simulado.js`) e cobrem as regras de proteção, o desfazer, o modo rede, o controle remoto e a escolha de APK por processador. Eles rodam no GitHub Actions a cada envio.
