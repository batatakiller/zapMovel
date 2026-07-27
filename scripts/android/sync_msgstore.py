#!/usr/bin/env python3
"""
Sincroniza o msgstore.db do WhatsApp Business para o ZapMóvel — rodando DENTRO
do tablet, via Termux. Não depende de PC nem de ADB.

Fluxo:
  backup do MIUI (.zip)  ->  .bak  ->  [pula cabeçalho]  ->  tar  ->  msgstore.db
  msgstore.db  ->  mensagens novas desde o último _id  ->  POST /api/ingest/android

Por que ler direto do .zip em streaming: o .bak tem 824 MB e o msgstore.db 370 MB.
Extrair tudo em disco no tablet gastaria ~1,2 GB por ciclo. O tarfile do Python
lê fluxo não-posicionável ('r|'), então dá para atravessar o tar e copiar só o
arquivo que interessa.

Uso:
    python sync_msgstore.py                 # sincroniza o backup mais recente
    python sync_msgstore.py --full          # ignora o estado, reenvia tudo
    python sync_msgstore.py --dry-run       # não envia, só conta
    python sync_msgstore.py --zip <caminho> # usa um zip específico

Config por variável de ambiente (ou ~/.zapmovel_sync.env):
    ZAP_API_URL     https://seuapp.vercel.app
    ZAP_API_TOKEN   token combinado com a rota /api/ingest/android
    ZAP_INSTANCE    nome da conta no ZapMóvel (ex.: tablet-loja)
"""

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

BACKUP_DIR = Path("/sdcard/MIUI/backup/AllBackup")
# msgstore = conversas; wa = agenda (nome de exibição dos contatos)
DBS_IN_TAR = {
    "apps/com.whatsapp.w4b/db/msgstore.db": "msgstore.db",
    "apps/com.whatsapp.w4b/db/wa.db": "wa.db",
}
STATE_FILE = Path.home() / ".zapmovel_sync_state.json"
ENV_FILE = Path.home() / ".zapmovel_sync.env"

# message_type do WhatsApp -> (tipo no ZapMóvel, rótulo exibido)
# Verificado contra os mime_type reais de message_media neste aparelho.
TYPE_MAP = {
    0: ("text", ""),
    1: ("image", "📷 Foto"),
    2: ("audio", "🎤 Áudio"),
    3: ("video", "🎬 Vídeo"),
    4: ("contact", "👤 Contato"),
    5: ("location", "📍 Localização"),
    9: ("document", "📄 Documento"),
    13: ("video", "🎬 GIF"),
    20: ("sticker", "💟 Figurinha"),
}
# tipos que são evento de sistema (entrou no grupo, mudou número, chamada...) e
# não devem virar mensagem na caixa de entrada
SYSTEM_TYPES = {7, 11, 15, 27, 36, 90, 99}

# status numérico do WhatsApp -> vocabulário do ZapMóvel. Só vale para o que
# VOCÊ enviou: em mensagem recebida o campo guarda outra coisa (0 é o normal),
# e interpretá-lo como "pendente" marcaria toda a caixa de entrada como não enviada.
STATUS_MAP = {4: "sent", 5: "delivered", 6: "read", 13: "read"}


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def load_env():
    """Lê ~/.zapmovel_sync.env (KEY=valor) sem sobrescrever o ambiente real."""
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip("\"'"))


def newest_backup_zip():
    if not BACKUP_DIR.is_dir():
        sys.exit(f"pasta de backup não encontrada: {BACKUP_DIR}")
    zips = sorted(BACKUP_DIR.glob("*.zip"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not zips:
        sys.exit(f"nenhum backup .zip em {BACKUP_DIR} — rode o backup do MIUI primeiro")
    return zips[0]


class _SkipHeader:
    """Envolve o stream do .bak devolvendo os bytes já a partir do tar.

    O .bak é: "MIUI BACKUP\\n2\\n<pacote>\\n...\\nANDROID BACKUP\\n5\\n0\\nnone\\n" + tar.
    O tamanho do cabeçalho varia com o nome do app, então localizamos 'none\\n'
    em vez de assumir um deslocamento fixo.
    """

    def __init__(self, raw):
        self.raw = raw
        head = raw.read(4096)
        idx = head.find(b"none\n")
        if idx == -1:
            raise RuntimeError("cabeçalho ANDROID BACKUP não encontrado no .bak")
        # 'none' = sem compressão. Se um dia vier comprimido, o tar falha adiante
        # com erro claro em vez de silenciosamente ler lixo.
        self.buf = head[idx + len(b"none\n"):]

    def read(self, n=-1):
        if not self.buf:
            return self.raw.read(n)
        if n is None or n < 0:
            rest, self.buf = self.buf, b""
            return rest + self.raw.read()
        if len(self.buf) >= n:
            out, self.buf = self.buf[:n], self.buf[n:]
            return out
        out, self.buf = self.buf, b""
        return out + self.raw.read(n - len(out))


def extract_dbs(zip_path: Path, dest_dir: Path):
    """Copia os bancos de dentro do .bak sem materializar o tar inteiro."""
    found = {}
    with zipfile.ZipFile(zip_path) as z:
        bak = next((n for n in z.namelist() if n.endswith(".bak")), None)
        if not bak:
            sys.exit(f"nenhum .bak dentro de {zip_path.name}")
        log(f"lendo {bak} ({z.getinfo(bak).file_size / 1e6:.0f} MB) em streaming…")
        with z.open(bak) as raw:
            stream = _SkipHeader(raw)
            # 'r|' = fluxo sequencial, não exige seek
            with tarfile.open(fileobj=stream, mode="r|") as tar:
                for member in tar:
                    name = DBS_IN_TAR.get(member.name)
                    if not name:
                        continue
                    log(f"extraindo {name} ({member.size / 1e6:.0f} MB)…")
                    src = tar.extractfile(member)
                    dest = dest_dir / name
                    with open(dest, "wb") as out:
                        while chunk := src.read(4 << 20):
                            out.write(chunk)
                    found[name] = dest
                    if len(found) == len(DBS_IN_TAR):
                        break
    if "msgstore.db" not in found:
        sys.exit("msgstore.db não encontrado no backup — o app foi incluído na seleção?")
    if "wa.db" not in found:
        log("aviso: wa.db ausente — nomes de contato virão vazios")
    return found


def load_state():
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except json.JSONDecodeError:
            log("estado corrompido, recomeçando do zero")
    return {}


def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2))


def dedupe_key(jid, ts_ms, from_me, text):
    """Mesma chave que a camada de notificação calcula — é o que permite ao
    msgstore corrigir a linha provisória em vez de duplicá-la."""
    base = f"{jid}|{ts_ms // 1000}|{int(bool(from_me))}|{(text or '').strip()}"
    return hashlib.sha1(base.encode("utf-8")).hexdigest()


def open_db(dbs: dict):
    """Abre o msgstore com o wa.db anexado, para resolver nome de contato.

    O nome de exibição mora em dois lugares distintos: wa_contacts (contatos com
    JID de telefone, vindos da agenda) e lid_display_name (contatos migrados para
    LID, onde o telefone não existe mais). Precisamos dos dois.
    """
    con = sqlite3.connect(f"file:{dbs['msgstore.db']}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    if "wa.db" in dbs:
        con.execute("attach database ? as wa", (f"file:{dbs['wa.db']}?mode=ro",))
    return con


def fetch_messages(con, since_id: int, limit: int, has_wa: bool):
    """Mensagens novas, já com jid do chat, nome, mídia e citação resolvidos."""
    placeholders = ",".join(str(t) for t in sorted(SYSTEM_TYPES))
    # o nome sai de wa_contacts (telefone) ou lid_display_name (LID); em grupo,
    # o assunto do próprio chat
    name_expr = "coalesce(ch.subject, ldn.display_name)"
    phone_expr = "null"
    name_join = ""
    if has_wa:
        # wa_address_book é a tabela que salva o dia: ela guarda jid '<n>@lid'
        # JUNTO com o telefone e o nome — é o único lugar do aparelho onde o
        # vínculo LID↔telefone sobreviveu. Cobre ~30-45% das conversas ativas;
        # o resto só tem nome pela notificação.
        name_expr = "coalesce(ch.subject, ab.display_name, wc.display_name, wc.wa_name, ldn.display_name)"
        phone_expr = "ab.number"
        # Agrupar por jid é obrigatório: a agenda tem o mesmo contato salvo mais
        # de uma vez (90 jids repetidos neste aparelho), e um join direto
        # multiplicaria a mensagem — o Postgres então rejeita o lote inteiro com
        # "ON CONFLICT DO UPDATE command cannot affect row a second time".
        name_join = """left join (
            select jid, max(display_name) display_name, max(wa_name) wa_name
            from wa.wa_contacts group by jid
        ) wc on wc.jid = jc.raw_string
        left join (
            select jid, max(display_name) display_name, max(number) number
            from wa.wa_address_book group by jid
        ) ab on ab.jid = jc.raw_string"""
    return con.execute(
        f"""
        select
            m._id            as row_id,
            m.key_id         as key_id,
            m.from_me        as from_me,
            m.timestamp      as ts,
            m.message_type   as mtype,
            m.text_data      as text_data,
            m.status         as status,
            jc.raw_string    as chat_jid,
            jc.server        as chat_server,
            js.raw_string    as sender_jid,
            {name_expr}      as chat_name,
            {phone_expr}     as chat_phone,
            mm.mime_type     as mime_type,
            mm.file_path     as file_path,
            mm.media_caption as caption,
            mq.key_id        as quoted_key_id
        from message m
        join chat ch on ch._id = m.chat_row_id
        join jid  jc on jc._id = ch.jid_row_id
        left join jid js on js._id = m.sender_jid_row_id
        left join lid_display_name ldn on ldn.lid_row_id = jc._id
        {name_join}
        left join message_media mm on mm.message_row_id = m._id
        left join message_quoted mq on mq.message_row_id = m._id
        where m._id > ?
          and m.message_type not in ({placeholders})
          and m.key_id is not null
          and jc.server not in ('newsletter', 'broadcast', 'status_me')
        order by m._id
        limit ?
        """,
        (since_id, limit),
    ).fetchall()


def to_payload(row, instance):
    mtype = row["mtype"]
    kind, label = TYPE_MAP.get(mtype, ("other", "[mensagem]"))
    caption = row["caption"]
    if kind == "text":
        content = row["text_data"]
    elif caption:
        content = f"{label} — {caption}"
    else:
        content = label

    ts_ms = row["ts"] or 0
    jid = row["chat_jid"]
    from_me = bool(row["from_me"])

    return {
        "instance": instance,
        "remote_jid": jid,
        "message_id": row["key_id"],
        "from_me": from_me,
        "push_name": row["chat_name"],
        "type": kind,
        "content": content,
        "status": (STATUS_MAP.get(row["status"], "sent") if from_me else "received"),
        "msg_timestamp": ts_ms,
        "quoted_message_id": row["quoted_key_id"],
        # Mídia usa texto VAZIO na chave, nos dois lados. O msgstore deixa
        # text_data nulo em 98% das imagens, enquanto a notificação manda o
        # rótulo ("📷 Foto") — sem esta regra as chaves nunca coincidem e cada
        # foto entra duas vezes na conversa.
        "dedupe_key": dedupe_key(jid, ts_ms, from_me, "" if kind != "text" else row["text_data"]),
        "origin": "msgstore",
        # caminho relativo do arquivo no armazenamento compartilhado — quem sobe
        # a mídia é o passo seguinte, aqui só registramos onde ela está
        "media_path": row["file_path"],
        "mime_type": row["mime_type"],
        "sender_jid": row["sender_jid"],
        "phone": row["chat_phone"],
        "is_group": row["chat_server"] == "g.us",
    }


def post_batch(api_url, token, batch, dry_run):
    if dry_run:
        return True
    body = json.dumps({"messages": batch}).encode("utf-8")
    req = urllib.request.Request(
        f"{api_url.rstrip('/')}/api/ingest/android",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(req, timeout=90) as res:
                if 200 <= res.status < 300:
                    return True
                log(f"resposta {res.status} — tentativa {attempt}/3")
        except (urllib.error.URLError, TimeoutError) as e:
            log(f"falha de rede ({e}) — tentativa {attempt}/3")
        time.sleep(2 ** attempt)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", type=Path, help="backup específico (padrão: o mais recente)")
    ap.add_argument("--full", action="store_true", help="reenvia tudo, ignorando o estado")
    ap.add_argument("--dry-run", action="store_true", help="não envia nada, só conta")
    ap.add_argument("--batch", type=int, default=500, help="mensagens por requisição")
    ap.add_argument("--limit", type=int, default=0, help="máximo de mensagens neste ciclo (0 = sem limite)")
    ap.add_argument("--keep-db", action="store_true", help="não apaga o msgstore.db extraído")
    ap.add_argument(
        "--since-date",
        help="carrega só a partir desta data (AAAA-MM-DD). Use na primeira carga para "
        "limitar o volume; depois o estado assume e cada ciclo vira incremental.",
    )
    args = ap.parse_args()

    load_env()
    api_url = os.environ.get("ZAP_API_URL")
    token = os.environ.get("ZAP_API_TOKEN")
    instance = os.environ.get("ZAP_INSTANCE")
    if not args.dry_run and not all((api_url, token, instance)):
        sys.exit("defina ZAP_API_URL, ZAP_API_TOKEN e ZAP_INSTANCE (ou use --dry-run)")
    instance = instance or "tablet"

    zip_path = args.zip or newest_backup_zip()
    log(f"backup: {zip_path.name} ({zip_path.stat().st_size / 1e6:.0f} MB)")

    state = {} if args.full else load_state()
    since_id = int(state.get("last_row_id", 0))
    log(f"último _id sincronizado: {since_id}")

    tmp_dir = Path(tempfile.mkdtemp(prefix="zapsync_"))
    con = None
    try:
        dbs = extract_dbs(zip_path, tmp_dir)
        con = open_db(dbs)
        has_wa = "wa.db" in dbs

        # --since-date vira um piso de _id: como o _id cresce junto com o tempo,
        # basta achar a primeira mensagem da data e seguir daí pra frente. O
        # estado continua sendo por _id, então os ciclos seguintes não precisam
        # da flag de novo.
        if args.since_date:
            import datetime as _dt

            try:
                corte = int(_dt.datetime.strptime(args.since_date, "%Y-%m-%d").timestamp() * 1000)
            except ValueError:
                sys.exit("--since-date deve estar no formato AAAA-MM-DD")
            row = con.execute(
                "select min(_id) from message where timestamp >= ?", (corte,)
            ).fetchone()
            piso = (row[0] or 1) - 1
            if piso > since_id:
                log(f"--since-date {args.since_date}: começando do _id {piso}")
                since_id = piso

        sent = 0
        max_id = since_id
        while True:
            remaining = args.limit - sent if args.limit else args.batch
            if args.limit and remaining <= 0:
                break
            rows = fetch_messages(con, max_id, min(args.batch, remaining), has_wa)
            if not rows:
                break
            batch = [to_payload(r, instance) for r in rows]
            if not post_batch(api_url, token, batch, args.dry_run):
                log("envio falhou após 3 tentativas — estado preservado, tente de novo")
                save_state({**state, "last_row_id": max_id})
                sys.exit(1)
            max_id = rows[-1]["row_id"]
            sent += len(rows)
            log(f"enviadas {sent} mensagens (último _id {max_id})")

        save_state({
            **state,
            "last_row_id": max_id,
            "last_sync": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "last_zip": zip_path.name,
        })
        log(f"pronto: {sent} mensagens novas{' (dry-run)' if args.dry_run else ''}")
    finally:
        if con:
            con.close()
        # os bancos somados passam de 400 MB — não pode sobrar lixo por ciclo
        if not args.keep_db:
            for f in tmp_dir.glob("*"):
                f.unlink()
            tmp_dir.rmdir()
        else:
            log(f"bancos preservados em {tmp_dir}")


if __name__ == "__main__":
    main()
