# Importar backup do WhatsApp (Android)

Guarde as conversas e arquivos de aparelhos antigos/formatados como uma **conta de arquivo** (só leitura) dentro do ZapMóvel. O importador lê o banco `msgstore.db` do WhatsApp e sobe as mídias para o mesmo bucket que o app já usa.

> **Pré-requisito:** você precisa do `msgstore.db` **descriptografado** (um SQLite comum). O importador **não** descriptografa `.crypt14`/`.crypt15` — veja abaixo como obter o arquivo aberto.

## 1. Obter o `msgstore.db` descriptografado + a mídia

No Android, os dados ficam em:

- **Banco:** `.../WhatsApp/Databases/msgstore.db.crypt15` (criptografado)
- **Mídia:** `.../WhatsApp/Media/` (fotos, áudios, vídeos, documentos — arquivos soltos)

A pasta `WhatsApp` costuma estar em `/sdcard/Android/media/com.whatsapp/WhatsApp` (Android 11+) ou `/sdcard/WhatsApp` (mais antigo).

Para transformar `msgstore.db.crypt15` em `msgstore.db`:

- **Backup com criptografia de ponta a ponta ligada:** use a chave de 64 dígitos hex (ou a senha) que o WhatsApp mostrou ao ativar o recurso, com a ferramenta open-source [`wa-crypt-tools`](https://github.com/ElDavoo/wa-crypt-tools):
  ```bash
  pip install wa-crypt-tools
  wadecrypt <sua-chave-hex> msgstore.db.crypt15 msgstore.db
  ```
- **Sem criptografia de ponta a ponta (`.crypt14`):** a chave fica em `/data/data/com.whatsapp/files/key` e só sai com **root** no aparelho. Com a chave: `wadecrypt key msgstore.db.crypt14 msgstore.db`.

Copie o `msgstore.db` já aberto e a pasta `WhatsApp` (ou só `WhatsApp/Media`) para o computador que roda o bridge.

## 2. Rodar o importador

```bash
npm run import -- ./msgstore.db \
  --instance zap-antigo \
  --label "Zap Antigo (Samsung)" \
  --color "#7E57C2" \
  --phone 5562999999999 \
  --media "/caminho/para/WhatsApp"
```

Opções:

| Flag | Obrigatória | O que faz |
|------|:-:|-----------|
| `<caminho do msgstore.db>` | sim | Banco descriptografado a importar. |
| `--instance` | sim | Identificador único da conta (minúsculas, números, hífen). |
| `--label` | não | Nome amigável exibido no app (padrão = o `--instance`). |
| `--color` | não | Cor da etiqueta na caixa unificada (padrão `#128C7E`). |
| `--phone` | não | Número dono da conta, só para exibição. |
| `--media` | não | Pasta que contém `Media/`. Sem ela, importa só os textos. |
| `--skip-media` | não | Importa as mensagens mas não sobe arquivos. |
| `--limit N` | não | Importa só as primeiras N mensagens (para testar). |

Recomendo um teste primeiro com `--limit 50 --skip-media` para conferir se as conversas aparecem, e depois rodar de novo sem os limites (o importador é idempotente: reexecutar não duplica).

## 3. Ver no app

A conta importada aparece na caixa unificada com a etiqueta e a cor escolhidas, marcada como **arquivo (só leitura)** — dá para ler e buscar tudo, mas não enviar (o aparelho não está mais conectado).

## Detalhes técnicos

- Suporta o schema **moderno** (`message` + `jid` + `chat`, WhatsApp desde ~2021) com upload de mídia, e o schema **antigo** (`messages`) para os textos.
- Cada mensagem vira uma linha em `zap_messages` com `instance = <--instance>`. A unicidade é `(instance, message_id)`, então a mesma conta importada duas vezes não gera duplicatas.
- As mídias vão para o bucket `chat_media` com o nome `<message_id>.<ext>` — o mesmo padrão que o `/api/media` já serve, então as fotos aparecem nas bolhas.
- Mensagens de sistema (avisos de criptografia, "entrou no grupo", chamadas sem conteúdo) são ignoradas.
- Requer Node 22.5+ (usa o `node:sqlite` embutido). Em versões < 24, rode com `node --experimental-sqlite scripts/import-msgstore.mjs ...`.
