# Tvbuild — Otimização segura de TV box e projetor Android via ADB

Deixa TV box Android e o projetor **HY300** (Allwinner) mais rápidos, **sem anúncios** e com interface limpa para streaming (YouTube, Netflix, IPTV/Kodi). Tudo roda do seu PC (Windows ou Linux), pela rede, usando ADB.

Dois jeitos de usar, com as mesmas regras e o mesmo histórico:
- **Painel (recomendado):** um sistema com interface no navegador que roda no seu PC. Dá para abrir também pelo celular. Veja [Painel](#painel-recomendado).
- **Linha de comando:** `tvopt.sh` / `tvopt.bat`, para quem prefere terminal. Veja [Linha de comando](#linha-de-comando).

> **Regras de segurança do projeto**
> - Nada de root, flash de firmware ou bootloader.
> - Só alterações reversíveis: `pm disable-user --user 0` ou `pm uninstall -k --user 0`. Nenhuma partição é apagada.
> - **Backup antes de qualquer alteração.** O script faz o backup sozinho se você esquecer: `pm list packages -f` mais todas as configurações, num `.txt` com data.
> - **Nunca são desativados:** o launcher em uso, o teclado, Wi-Fi, Bluetooth, Configurações, SystemUI, GMS/framework, HDMI/CEC, nem keystone/foco do projetor. A lista fica em [`config/protegidos.txt`](config/protegidos.txt) e o script recusa esses pacotes mesmo que você peça.
> - Pacotes desconhecidos caem na lista **DÚVIDA** e nunca são desativados automaticamente.
> - Cada comando é **explicado antes de rodar**, e as etapas que alteram algo pedem **confirmação (s/N)**.
> - Toda alteração é registrada e pode ser desfeita com `desfazer`.

## Estrutura

```
iniciar-painel.bat / .sh     Abre o painel (dois cliques no Windows)
painel/                      Painel local: servidor Node.js sem dependências + interface web
tvopt.sh                     Linha de comando (Linux / macOS / Git Bash no Windows)
tvopt.bat                    Atalho para Windows (roda o tvopt.sh pelo Git Bash)
windows/coletar_e_backup.bat Coleta de informações + backup só com Windows (não altera nada)
config/protegidos.txt        Pacotes que NUNCA são alterados (padrões regex)
config/bloat_seguro.txt      Bloatware conhecido e seguro de desativar
config/launchers_anuncio.txt Launchers de fábrica com anúncios (só na etapa 5)
saida/<ip>/                  Backups, relatórios e scripts gerados (fica fora do git)
```

---

## Passo 0: preparar o PC

1. Baixe o **Android SDK Platform-Tools**: https://developer.android.com/tools/releases/platform-tools
   - **Windows:** extraia em `C:\platform-tools` e coloque essa pasta no PATH (Painel de Controle → Sistema → Variáveis de ambiente → Path → Novo).
   - **Linux:** `sudo apt install adb` (Debian/Ubuntu) ou `sudo dnf install android-tools` (Fedora).
2. Para o **painel**: instale o **Node.js LTS** (versão 18 ou mais nova) em https://nodejs.org. No Linux: `sudo apt install nodejs`.
   Para a **linha de comando no Windows**: instale o **Git for Windows** (https://git-scm.com/download/win).
3. Baixe este projeto: no GitHub, clique em **Code → Download ZIP** e extraia, ou use o git:
   ```bash
   git clone https://github.com/Nikolas10k/Tvbuild.git
   ```
4. Confirme que o adb funciona:
   ```bash
   adb version
   ```

## Passo 1: ativar Opções do desenvolvedor e Depuração ADB

### TV box (Android TV / Google TV / box genérico AOSP)

1. **Configurações → Preferências do dispositivo → Sobre** (em box genérico: **Configurações → Sobre** ou **Sistema → Sobre**).
2. Vá até **Build / Número da versão** e aperte **OK 7 vezes** no controle até aparecer "Você agora é um desenvolvedor".
3. Volte e abra **Preferências do dispositivo → Opções do desenvolvedor** (ou **Sistema → Opções do desenvolvedor**).
4. Ative **Depuração USB**. Se aparecer, ative também **Depuração ADB pela rede** (*Network debugging / ADB over network*).
5. Descubra o IP em **Configurações → Rede e Internet → (sua rede Wi-Fi) → Endereço IP**.
6. **Recomendado:** reserve esse IP no roteador (DHCP estático) para ele não mudar.

> Boxes genéricos (MXQ Pro, X96 etc.) muitas vezes já vêm com ADB em rede ligado na porta 5555. Se `adb connect` funcionar logo de cara, não precisa mexer.

### Projetor HY300 (Allwinner)

1. **Configurações** (ícone de engrenagem) → **Sobre / About** → aperte **OK 7 vezes** em **Build number / Versão**.
2. Volte em **Configurações → Sistema / Opções do desenvolvedor**.
3. Ative **Depuração USB** e, se existir, **Depuração ADB pela rede**.
4. Algumas versões do HY300 escondem as configurações do Android atrás do launcher próprio. Nesse caso, abra **Configurações → Mais configurações / Android Settings** para chegar ao menu completo.
5. O IP fica em **Configurações → Rede → Wi-Fi → (sua rede)**.

### Android 11+ sem "ADB pela rede"

Se só houver **Depuração sem fio** (*Wireless debugging*), ela usa pareamento:

```bash
adb pair IP:PORTA_DE_PAREAMENTO
```
Digite o código mostrado na TV e depois conecte na porta exibida em "Depuração sem fio":
```bash
adb connect IP:PORTA
```
Nos comandos do `tvopt`, use `IP:PORTA` no lugar do IP.

**Na primeira conexão aparece "Permitir depuração?" na tela.** Marque **"Sempre permitir deste computador"** e confirme.

---

## Painel (recomendado)

**Windows:** dê dois cliques em `iniciar-painel.bat`. O navegador abre em `http://localhost:7311`.
**Linux:**
```bash
bash iniciar-painel.sh
```

Deixe a janela preta aberta enquanto usa o painel; fechar a janela fecha o painel. Não precisa de `npm install`, porque o painel não tem dependências.

### Como funciona

1. **Adicione o aparelho** na lateral (nome, IP e tipo: TV box ou HY300). O painel conecta sozinho. Na primeira vez, aceite **"Permitir depuração?"** na TV.
2. **Visão geral:** modelo, Android, chip, RAM, armazenamento e o roteiro com o que já foi feito. A primeira leitura grava a RAM "antes".
3. **Apps:** classifica tudo em *Bloatware seguro / Dúvida / Launchers com anúncio / Seus apps / Essenciais*. Essenciais e seus apps não podem ser marcados. Marque, clique em **Revisar e desativar** e confira a lista de comandos antes de executar. Itens da lista Dúvida exigem marcar "Pesquisei e tenho certeza".
4. **Launcher:** abre o Projectivy na Play Store da TV ou instala um APK do PC, define como padrão e só então libera desativar o launcher antigo. Também instala SmartTube, Kodi etc. a partir de um APK.
5. **Desempenho:** animações 0.5x, bloquear apps que rodam sozinhos, limpar cache e liberar RAM.
6. **Projetor HY300** (só para aparelhos do tipo HY300): resolução real, keystone/foco e firmware, com botão para abrir o app de atualização oficial.
7. **Histórico e desfazer:** RAM antes/agora, cada alteração com botão **Desfazer** individual, **Desfazer tudo**, **Gerar scripts reaplicar/desfazer** (.bat e .sh) e download de backups e relatórios.

A barra **Atividade**, no rodapé, mostra cada comando executado e a resposta do aparelho.

### Usar pelo celular

```bash
bash iniciar-painel.sh --rede
```
No Windows: `iniciar-painel.bat --rede`. A janela mostra um link como `http://192.168.0.10:7311/#t=código`: abra esse link no celular, na mesma rede Wi-Fi. O código muda a cada vez que o painel é iniciado. Sem ele, ninguém na rede consegue usar o painel. Se o Windows perguntar sobre o firewall, permita só em **redes privadas**.

### Segurança do painel

- Por padrão, só aceita conexões do próprio PC (`127.0.0.1`).
- Recusa pedidos de outros sites abertos no navegador (cabeçalho obrigatório e checagem de host).
- Valida nomes de pacote e IP antes de mandar qualquer coisa ao aparelho, e nada passa pelo shell do PC.
- Usa as mesmas listas de `config/` e o mesmo registro `saida/<ip>/estado/alteracoes.log` do `tvopt.sh`: o que você fizer no painel pode ser desfeito pela linha de comando e vice-versa.
- Não dá para hospedar o painel no Vercel ou em outro servidor na internet: ele precisa estar na mesma rede dos aparelhos para falar com eles pelo ADB.

---

## Linha de comando

Linux: `./tvopt.sh <IP> <comando>` (se baixou o ZIP, rode antes `chmod +x tvopt.sh`) · Windows: `tvopt.bat <IP> <comando>`

Exemplos com a TV box em `192.168.0.50` e o HY300 em `192.168.0.51`:

| Etapa | Comando | Altera algo? |
|---|---|---|
| 2. Info (modelo, Android, chip, RAM, armazenamento) | `./tvopt.sh 192.168.0.50 info` | Não |
| Backup (pacotes + configurações) | `./tvopt.sh 192.168.0.50 backup` | Não |
| 3. Classificar apps | `./tvopt.sh 192.168.0.50 classificar` | Não |
| 4. Desativar bloatware | `./tvopt.sh 192.168.0.50 desativar` | **Sim, com confirmação** |
| 4b. Desativar item da lista DÚVIDA (após pesquisar) | `./tvopt.sh 192.168.0.50 desativar com.exemplo.app` | **Sim, com confirmação** |
| 5. Launcher leve (Projectivy) | `./tvopt.sh 192.168.0.50 launcher` | **Sim, com confirmação** |
| Instalar APKs (SmartTube, Kodi...) | `./tvopt.sh 192.168.0.50 instalar SmartTube.apk` | Sim |
| 6. Desempenho | `./tvopt.sh 192.168.0.50 desempenho` | **Sim, com confirmação** |
| 7. Diagnóstico HY300 | `./tvopt.sh 192.168.0.51 hy300` | Não (só abre o app de atualização se você pedir) |
| 8. Gerar scripts reaplicar/desfazer | `./tvopt.sh 192.168.0.50 gerar-scripts` | Não |
| Desfazer tudo | `./tvopt.sh 192.168.0.50 desfazer` | Sim (reverte) |
| 9. Resumo (RAM antes/depois) | `./tvopt.sh 192.168.0.50 resumo` | Não |
| Fluxo guiado completo | `./tvopt.sh 192.168.0.50 tudo` | Pergunta a cada etapa |

**Teste sem alterar nada:** antes de qualquer etapa, rode em modo simulação, que só mostra os comandos:

```bash
SIMULAR=1 ./tvopt.sh 192.168.0.50 desativar
```

### Fluxo recomendado (por aparelho)

1. `info`: a primeira execução grava a **RAM disponível "antes"**. Reinicie o aparelho e espere 2 minutos antes, para a medição ser justa.
2. `backup`
3. `classificar`: revise o arquivo `saida/<ip>/classificacao_<data>.txt`. **Pesquise cada item da lista DÚVIDA** (ou pergunte) antes de desativar.
4. `desativar`: mostra os candidatos e pergunta: **[t]odos / [u]m por um / [n]ão**.
5. `launcher`: instala/define o Projectivy e só **depois** oferece desativar o launcher antigo com anúncios, conferindo antes se o novo launcher realmente está em uso.
6. `desempenho`
7. `hy300` (só no projetor)
8. `gerar-scripts`: cria `reaplicar_<ip>.sh/.bat` e `desfazer_<ip>.sh/.bat` em `saida/<ip>/`, com exatamente o que foi feito naquele aparelho. Os `.bat` rodam no Windows sem Git Bash.
9. Reinicie, espere 2 minutos e rode `resumo`.

---

## O que cada etapa faz

### 3. Classificação
- **Essencial/protegido:** casa com [`config/protegidos.txt`](config/protegidos.txt), ou é o launcher/teclado em uso. Nunca é alterado.
- **Bloatware seguro:** está em [`config/bloat_seguro.txt`](config/bloat_seguro.txt) (agenda, e-mail, impressão, papéis de parede animados, recomendações/anúncios do Google, Adups FOTA, Facebook pré-instalado...).
- **Launcher com anúncio:** está em [`config/launchers_anuncio.txt`](config/launchers_anuncio.txt). Só é tratado na etapa 5.
- **Seus apps:** instalados por você. Não mexemos.
- **Dúvida:** qualquer outro app de sistema. Só é desativado se você pedir explicitamente pelo nome.

### 4. Desativação
- Padrão: `pm disable-user --user 0 <pacote>`, que esconde e para o app. Reverte com `pm enable --user 0 <pacote>`.
- Com `--remover`: `pm uninstall -k --user 0 <pacote>` remove o app só para o usuário, mas o APK continua no sistema. Reverte com `cmd package install-existing <pacote>`.

### 5. Launcher e apps sugeridos
- **Projectivy Launcher** (`com.spocky.projengmenu`): leve, sem anúncios, ótimo para controle remoto. O script abre a página na Play Store da TV ou instala um APK que você baixou (`launcher caminho.apk`).
- Define o padrão com `cmd package set-home-activity`. Se o seu Android não aceitar, aperte HOME no controle, escolha Projectivy e depois **"Sempre"**.
- **Google TV:** antes de desativar o launcher do Google, ative no Projectivy **Configurações → "Substituir botão Home"** (usa acessibilidade).
- Apps sugeridos:
  - **SmartTube**: YouTube sem anúncios, com SponsorBlock. APK oficial em https://smarttubeapp.github.io
  - **Kodi**: mídia local, IPTV (PVR IPTV Simple Client) e add-ons. Pela Play Store ou https://kodi.tv
  - **TV Bro**: navegador leve feito para controle remoto.
  - **X-plore File Manager**: gerenciador de arquivos com acesso à rede (SMB).
  - **Send Files to TV**: envia APKs do celular para a TV.
- Netflix: use o app que veio com o aparelho ou o da Play Store. O app de celular não funciona bem na TV.

### 6. Desempenho
- **Animações em 0.5x** (`settings put global window_animation_scale|transition_animation_scale|animator_duration_scale 0.5`). O valor original fica registrado para o desfazer.
- **Apps que iniciam sozinhos:** para cada app instalado por você, pergunta se deve bloquear o segundo plano (`cmd appops set <app> RUN_IN_BACKGROUND ignore`, Android 8+). O app continua abrindo normalmente, só não fica rodando escondido.
- **Limpar cache:** `pm trim-caches 999G`, que não apaga logins nem dados.
- **Limite de processos em segundo plano:** **não é confiável por ADB** e volta ao padrão a cada reinício. Para usar, configure manualmente em *Opções do desenvolvedor → Limite de processos em segundo plano → "No máximo 2"*. Só vale a pena em aparelhos com 1 a 2 GB de RAM.
- `am kill-all`: encerra processos em cache agora. É temporário.

### 7. HY300
- **Resolução real:** o painel do HY300 é **1280×720 nativo**, mesmo que a caixa diga "4K". O relatório mostra o que o Android desenha (`wm size`) e os modos do driver. **Não altere `wm size`.**
- **Keystone/foco:** lista os apps e configurações de correção (todos protegidos). Dica: keystone digital forte reduz a nitidez. Prefira alinhar o projetor fisicamente e usar o mínimo de correção.
- **Atualização:** mostra a versão do firmware e os apps de atualização encontrados, e pode abrir o app oficial na tela. **Firmware só da fonte oficial; este projeto nunca instala firmware.**

### 8. Desfazer
- `./tvopt.sh <IP> desfazer` reverte tudo do registro `saida/<ip>/estado/alteracoes.log`, em ordem inversa: reativa apps, reinstala os removidos, restaura configurações, permissões de segundo plano e o launcher original.
- Sem o PC com o projeto? Use o `desfazer_<ip>.bat` ou `.sh` gerado na etapa 8.
- Último recurso, se algo der muito errado: **Configurações → Restaurar padrões de fábrica** volta tudo, porque nada foi apagado do sistema.

---

## Personalizar

- Adicionar bloatware que você confirmou: inclua uma linha em `config/bloat_seguro.txt` no formato `pacote  # descrição`.
- Proteger mais coisas: inclua um padrão regex em `config/protegidos.txt`.
- `SIM=1` aceita todas as confirmações automaticamente (use só quando já souber o que vai acontecer, por exemplo para reaplicar num aparelho igual).

## Solução de problemas

| Problema | Solução |
|---|---|
| `unauthorized` | Aceite o aviso "Permitir depuração" na TV. Se não aparecer: `adb kill-server`, desligue e ligue a depuração e tente de novo. |
| `failed to connect` / `connection refused` | Confira o IP, se PC e TV estão na mesma rede e se a depuração em rede está ativa. No Android 11+ use o pareamento (veja acima). |
| A conexão cai após reiniciar a TV | Normal em alguns aparelhos: rode o comando de novo e o script reconecta. |
| Um app sumiu e faz falta | `./tvopt.sh <IP> desfazer` ou `adb shell pm enable --user 0 <pacote>`. |
| Tela inicial preta depois de desativar o launcher | Rode o `desfazer`. Se não tiver o PC à mão, use o controle: **Configurações → Apps → mostrar apps do sistema → (launcher) → Ativar**. |
