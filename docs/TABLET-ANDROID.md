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

`zap_jid_map` acumula o que se descobre por outras vias (o número aparece em
`android.textLines` para contatos não salvos, e na tela do chat).

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
- A camada 1 (notificação) — captura em tempo real e Direct Reply
- Consumo do `zap_outbox` pelo aparelho (a tabela e a reserva atômica já existem)
- Disparo automático do backup do MIUI (a activity é exportada:
  `miui.intent.backup.LOCAL_HOME_ACTIVITY`, mas pede a senha do aparelho)

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
