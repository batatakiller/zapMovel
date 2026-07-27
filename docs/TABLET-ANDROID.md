# Transporte via tablet Android (WhatsApp Business)

Alternativa ao Evolution/Baileys, criada porque as contas vinham sendo
**suspensas** pelo WhatsApp. Aqui o WhatsApp Business roda de verdade num tablet
(Redmi Pad SE, HyperOS 2) e o ZapMóvel lê o aparelho — não há cliente falso se
passando por WhatsApp Web.

## As duas camadas

| | Camada 1 — notificação | Camada 2 — msgstore |
|---|---|---|
| Latência | segundos | por ciclo de backup |
| Cobertura | só o que gera notificação | **tudo** |
| `message_id` real | não (sintético `nl:…`) | sim |
| Mídia, citação, status | não | sim |
| Papel | avisar e responder rápido | fonte de verdade e backup |

A camada 2 **corrige** as linhas da camada 1 em vez de duplicá-las: as duas
calculam a mesma `dedupe_key` (sha1 de `jid|epoch_s|from_me|texto`), e a
ingestão troca o id sintético pelo real na mesma linha (ver
[lib/android-ingest.ts](../lib/android-ingest.ts)).

## Como o banco sai do aparelho sem root

O backup local do MIUI tem privilégio de sistema e ignora o `allowBackup=false`
do WhatsApp. O arquivo gerado é um Android Backup disfarçado:

```
backup .zip
  └── WhatsApp Business(com.whatsapp.w4b).bak
        "MIUI BACKUP\n2\n…\nANDROID BACKUP\n5\n0\nnone\n" + tar (sem compressão)
              └── apps/com.whatsapp.w4b/db/msgstore.db   ← SQLite EM CLARO
                  apps/com.whatsapp.w4b/db/wa.db         ← agenda/nomes
```

Nada de crypt14/crypt15, nada de chave de 64 dígitos, nada de root. O
`sync_msgstore.py` localiza `none\n` (o cabeçalho varia com o nome do app) e lê
o tar em fluxo, copiando só os dois bancos — sem materializar os 824 MB.

## Limitação importante: LID

O WhatsApp migrou os identificadores de conversa para **LID** (`<n>@lid`), que
não revela o telefone. Medido neste aparelho em 26/07/2026:

- últimos 30 dias: **10.184** mensagens em chats LID contra **640** com telefone
- dos 473 contatos com JID `@lid` em `wa_contacts`, **nenhum** tem `number`
- `sender_jid` vem nulo nesses chats

O telefone **não existe no aparelho** para esses contatos — é o design de
privacidade do WhatsApp, não uma falha da extração. Consequências:

- ✅ arquivar histórico, ler, reconciliar: tudo funciona (o `@lid` do backup casa
  exatamente com o `shortcut=<n>@lid` da notificação)
- ✅ responder quem te chamou: Direct Reply não usa telefone
- ✅ iniciar conversa com número que você já tem: `wa.me/<numero>` funciona normal
- ⚠️ discar a partir de uma conversa LID antiga: não há número para usar

`zap_jid_map` acumula o que se descobre por outras vias — ver "Atalhos do
Android" logo abaixo, que é a melhor delas.

## Configuração no tablet

1. **Termux** — `pkg install python`
2. `~/.zapmovel_sync.env`:
   ```
   ZAP_API_URL=https://seuapp.vercel.app
   ZAP_API_TOKEN=<mesmo valor de ANDROID_INGEST_TOKEN no servidor>
   ZAP_INSTANCE=tablet-loja
   ```
3. Conta cadastrada em `zap_accounts` com `transport = 'android'`
4. **Autostart + sem otimização de bateria** para Termux, Tasker e WhatsApp
   Business — sem isso a MIUI derruba os serviços em segundo plano e a
   sincronização para em silêncio, sem erro visível.

## Uso

```bash
python sync_msgstore.py              # backup mais recente, só o que é novo
python sync_msgstore.py --dry-run    # não envia, só conta
python sync_msgstore.py --full       # reenvia tudo (ignora o estado)
```

O estado (`~/.zapmovel_sync_state.json`) guarda o último `message._id` enviado —
é o que torna cada ciclo incremental. Se o envio falhar, o estado não avança e o
ciclo seguinte retoma do mesmo ponto.

## O que ainda não existe

- Upload da mídia para o bucket `chat_media` (o caminho do arquivo já vem em
  `raw.media_path`, mas ninguém sobe o arquivo ainda)
- Iniciar conversa nova pelo ZapMóvel (o Direct Reply só responde; iniciar
  exigiria abrir `wa.me/<numero>` e tocar em enviar por acessibilidade)
- Deploy da rota na Vercel — hoje o teste depende de `adb reverse` e do cabo
- Disparo automático do backup do MIUI (a activity é exportada:
  `miui.intent.backup.LOCAL_HOME_ACTIVITY`, mas pede a senha do aparelho)
- Ciclo do msgstore rodando sozinho no tablet, via Termux

## Camada 1 — o app companion (android-agent/)

App próprio em Java, compilado sem gradle nem Android Studio
([android-agent/build.sh](../android-agent/build.sh) encadeia aapt2 → javac →
d8 → apksigner). Escrito em Java porque `kotlinc` não estava disponível e para
um NotificationListener não há diferença prática.

O que ele extrai da notificação, verificado no aparelho:

```
notificacao de com.whatsapp.w4b shortcutId=173027740393727@lid temMessages=true
conversa 173027740393727@lid -> 3 mensagem(ns) nova(s)
enviadas 3 mensagens
```

`shortcutId` é o mesmo `<n>@lid` que o msgstore usa, então as duas camadas
falam do mesmo chat. E `android.title` traz o nome que o WhatsApp exibe — a
**única** fonte de nome para conversa LID, já que a agenda do aparelho não a
cobre.

### A dedupe_key precisa ser idêntica nos dois lados

Java e Python calculam `sha1("<jid>|<segundos>|<0|1>|<texto trim>")`. Se
divergirem em um byte, a mesma mensagem entra duas vezes — uma por camada.
Conferido com acentos, quebra de linha, espaços nas pontas e texto vazio.

**Ainda não validado na prática:** se o timestamp da notificação e o do
msgstore divergirem em 1 segundo, a chave muda e a reconciliação falha. Só dá
para confirmar com um backup feito depois de mensagens capturadas pela
notificação.

### Armadilhas do aparelho (todas custaram tempo)

- **MIUI não vincula o listener** depois de instalar/atualizar: fica
  "autorizado" e não recebe nada. O botão *Reconectar o serviço* chama
  `requestRebind()`, que resolve. Repetir a cada atualização do app.
- **Cleartext HTTP bloqueado** por padrão no targetSdk moderno. O
  `network_security_config.xml` libera só `localhost` (o teste por cabo);
  produção continua exigindo TLS.
- **Início automático da MIUI** precisa estar ligado, senão o serviço não sobe
  depois de reiniciar.
- **`uiautomator` mostra a dica do campo como se fosse o texto** — "vazio" e
  "preenchido" parecem iguais no dump. Confira pelo comprimento do texto.

### Configuração

URL e conta já vêm preenchidas no app (`Config.URL_PADRAO` /
`CONTA_PADRAO`); só o token precisa ser digitado. Para o teste por cabo:
`adb reverse tcp:3000 tcp:3000` e URL `http://localhost:3000`.

## Envio: Direct Reply pela fila

```
/api/send (conta transport=android)
   -> zap_outbox (fila)  +  bolha 'pending' na conversa
   -> agente puxa /api/outbox/next a cada 10s (reserva com skip locked)
   -> ReplyRegistry dispara o PendingIntent da ação "Responder"
   -> /api/outbox/ack marca 'sent' e a bolha deixa de ser pendente
```

Entre um envio e outro há pausa aleatória de 3 a 7 segundos: rajada é o padrão
que motivou as suspensões que originaram este projeto.

**Limite estrutural:** a ação "Responder" só existe enquanto a notificação
daquela conversa está viva. Abrir o chat no tablet cancela o `PendingIntent` e
o envio falha com *"notificação expirou"*. Consequências: o tablet precisa ficar
como servidor, sem ninguém mexendo na tela; e dá para **responder** quem
escreveu, não para **iniciar** conversa.

Falha não volta direto para `queued` pelo ack — quem devolve à fila é a própria
`zap_outbox_claim`, recuperando linhas presas em `sending` há mais de 5 minutos.
Com `attempts < 5`, uma falha permanente esgota em vez de virar laço.

## Reconciliação: a rede de segurança do timestamp

A `dedupe_key` trunca no segundo, então basta a notificação e o msgstore
discordarem em 1 segundo para a mensagem duplicar. É ainda mais provável na
bolha otimista: o horário que gravamos não é o horário em que o WhatsApp de fato
enviou. Por isso, quando a chave exata não casa, a ingestão procura a linha
provisória por `(remote_jid, from_me, conteúdo)` dentro de uma janela de 3
minutos.

## Produção

App em `https://zapmovel.vercel.app`; `ANDROID_INGEST_TOKEN` nas variáveis de
ambiente da Vercel (Production). O agente aponta para lá por padrão
(`Config.URL_PADRAO`), então não depende mais de cabo nem de `adb reverse`.

**Keep-alive precisa ficar desligado.** O `HttpURLConnection` do Android
reaproveita conexões do pool, mas a Vercel as fecha antes — o cliente escreve
num socket morto e falha com `unexpected end of stream`. Ambas as classes de
rede mandam `Connection: close`. Custa um handshake por requisição.

### O ReplyRegistry vive em memória

As ações de resposta são guardadas em RAM, porque um `PendingIntent` não é
serializável. Toda vez que o serviço reinicia — app atualizado, MIUI matando o
processo, tablet reiniciado — elas se perdem, e só voltam conforme cada conversa
notificar de novo. Envios enfileirados nesse intervalo falham com *"sem
notificação ativa desta conversa"* e esgotam em 5 tentativas.

No uso normal isso quase não aparece (responder quem acabou de escrever usa uma
notificação fresca), mas é a explicação para falhas que pareceriam aleatórias.

## Atalhos do Android: onde o vínculo LID↔telefone sobreviveu

O banco do WhatsApp não guarda o telefone das conversas LID (medido: 8 de 2.587
cobertas pela agenda). Mas o **ShortcutManager do Android** mantém um atalho por
conversa, e nele:

```
ShortcutInfo {id=96344739999989@lid, ...
  shortLabel=+55 81 8593-7934
```

O `id` é o LID e o `shortLabel` é o nome do contato — ou **o telefone**, quando
não está salvo na agenda (justamente o caso das conversas LID). É a única fonte
encontrada que devolve o número.

`scripts/android/import_shortcuts.py` lê isso via `adb shell dumpsys shortcut`,
grava em `zap_jid_map` e preenche `push_name` onde estiver vazio (sem
sobrescrever nome vindo da notificação, que é melhor).

**Limites:** o Android guarda algumas dezenas de atalhos, sempre das conversas
mais recentes — não recupera histórico antigo. E exige o tablet no cabo, porque
ler atalhos de outro app precisa de permissão de launcher, que o agente não tem.
Rode de tempos em tempos.

Resultado na primeira execução: 56 conversas recuperadas (46 com telefone, 10
com nome), levando a lista de 3 para 46 conversas identificadas de 65.

## Recebimento de mídia

A notificação do WhatsApp entrega a mídia direto: o MessagingStyle traz
`uri` + `type` (verificado: `type=image/jpeg uri=true`). Isso dispensa vasculhar
`/sdcard` e adivinhar por horário qual arquivo pertence a qual mensagem — algo
que seria frágil e que chegamos a planejar antes de medir.

```
notificação (uri + type)
   -> mensagem vira type=image/video/... em vez de texto
   -> POST /api/ingest/media (binário puro, não base64)
   -> bucket chat_media como <message_id>.<ext>
   -> /api/media serve para o app
```

Limite de 12 MB por arquivo: no histórico deste aparelho, vídeo foram 6,67 GB
em apenas 1.285 arquivos, então um único arquivo grande consome cota à toa.

### Detalhes que só apareceram testando

- **A foto notifica duas vezes**: primeiro sem a mídia (ainda baixando), depois
  com ela. A deduplicação descartava a segunda e a imagem se perdia — a
  mensagem ficava como texto para sempre. O agente não descarta mais antes de
  subir o arquivo, e a ingestão promove a linha de `text` para `image`.
- **O texto da notificação já é o rótulo** ("📷 Foto") quando não há legenda.
  Concatenar com o nosso rótulo gerava "📷 Foto — 📷 Foto".
- **A dedupe_key de mídia usa a legenda pura**, não o rótulo com emoji — é
  assim que o msgstore calcula, e as duas precisam coincidir.
- **`/api/media` rejeitava o id sintético**: a validação não permitia `:`, e
  `nl:<hash>` caía em "id inválido" mesmo com o arquivo no bucket.
- **Arquivo órfão**: a rota exige que a mensagem exista antes de gravar, senão
  devolve 404 e descarta.

## O eco da própria mensagem

Depois de responder pelo ZapMóvel, o WhatsApp **reescreve a notificação da
conversa incluindo a sua resposta**. O listener lia essa notificação e gravava a
mensagem outra vez, agora como recebida — a conversa mostrava tudo duas vezes,
uma bolha de cada lado.

Corrigido em duas camadas:

- **No agente:** o `MessagingStyle` só marca remetente para o outro lado — a sua
  mensagem vem sem `sender` e sem `sender_person`. É esse o sinal usado.
- **No servidor:** mensagem recebida cujo texto e conversa batem com uma enviada
  nos últimos 10 minutos é descartada, caso o aparelho fique numa versão antiga.

Ao limpar os ecos já gravados, vale lembrar do **limite implícito de 1000 linhas**
do PostgREST: uma varredura sem filtro de tempo não encontra as linhas recentes
e dá a falsa impressão de que não há nada a corrigir.

## Ciclo automático no tablet (Termux)

`scripts/android/termux/` roda o msgstore sem PC:

```
setup.sh   instala python, copia os scripts, pede o token (digitação oculta)
loop.sh    a cada 30 min, processa o backup do MIUI se houver um NOVO
```

O `/sdcard` é a ponte: a casa do Termux é privada e não se enxerga de fora, mas
os dois lados leem `/sdcard/zapmovel/`.

Para fechar a autonomia, o **backup automático do MIUI** precisa estar ligado:
Configurações adicionais do backup → "Fazer backup automaticamente" → Dias
(vem como "Nunca"; o horário já é 02:30). Confirme que "Itens para o backup"
inclui o WhatsApp Business. Com isso o MIUI gera o backup de madrugada e o loop
o processa sozinho.

`termux-wake-lock` é essencial: sem ele o Android suspende o processo quando a
tela apaga e o ciclo para em silêncio.

## Upload de mídia pelo msgstore

A notificação só traz a mídia do que chegou com o agente rodando. Mensagem que
chegou com a conversa aberta no tablet, ou com o serviço parado, fica com a
bolha "📷 Foto" e nenhum arquivo.

`scripts/android/upload_media.py` fecha esse buraco pelo outro lado: o msgstore
grava em `raw.media_path` onde o arquivo está, e o script lê de `/sdcard` e
envia para a mesma rota que a notificação usa.

```bash
python upload_media.py              # pendências dos últimos 7 dias
python upload_media.py --dias 30    # janela maior (assim se sobe histórico)
python upload_media.py --tipos image,document,video
```

Vídeo fica de fora por padrão: no histórico deste aparelho foram 6,67 GB em
apenas 1.285 arquivos, e o Storage do plano gratuito tem 1 GB.

Roda em lotes de 200 (`--limite`), então repetir o comando cobre o resto.
Primeira execução: 236 arquivos enviados, nenhuma falha, nenhum arquivo ausente
no aparelho. Cobertura passou de 3 para **246 de 278 (88%)** nos últimos 7 dias.

O que sobra são mensagens que só a notificação viu e que ainda não passaram por
um backup — elas ganham `media_path` no ciclo das 02:00.

## Contas: ocultar e conta padrão

`enabled=false` tira a conta do painel sem apagar nada; `is_default` faz o painel
abrir já filtrado nela (índice único garante no máximo uma). Ocultar a conta
padrão limpa o padrão automaticamente — senão o painel abriria num filtro
invisível e a lista pareceria vazia sem explicação.

## Push das mensagens do tablet

O push é disparado **só na camada da notificação**, que é a que chega em
segundos. O msgstore vem horas depois com mensagem que você já viu; notificar de
novo seria repetir aviso velho.
