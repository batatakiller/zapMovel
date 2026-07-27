#!/usr/bin/env python3
"""
Recupera nome/telefone das conversas LID a partir dos atalhos do Android.

Por que isto existe: o WhatsApp migrou as conversas para identificadores LID
(`<n>@lid`), que não revelam o telefone, e o banco do aparelho não guarda o
vínculo — medimos 8 de 2.587 conversas cobertas pela agenda. Mas o Android
mantém um atalho por conversa (o mesmo usado em bolhas e no compartilhamento),
e nele o `id` é o LID enquanto o `shortLabel` é o nome do contato — ou o
telefone, quando não está salvo.

Limite: o Android guarda algumas dezenas de atalhos, sempre das conversas mais
recentes. Não recupera o histórico inteiro, só o que está ativo — que é
justamente o que aparece na lista.

Precisa do tablet conectado por USB (usa adb). Rode de tempos em tempos.

Uso:
    python import_shortcuts.py                # lê do aparelho e grava
    python import_shortcuts.py --dry-run      # só mostra o que faria
    python import_shortcuts.py --arquivo d.txt  # usa um dump já salvo
"""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

ENV = Path(__file__).resolve().parents[2] / ".env.local"
INSTANCE = os.environ.get("ZAP_INSTANCE", "tablet-loja")


def carregar_env():
    if not ENV.exists():
        sys.exit(f"não achei {ENV}")
    for linha in ENV.read_text().splitlines():
        linha = linha.strip()
        if linha and not linha.startswith("#") and "=" in linha:
            k, v = linha.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip("\"'"))


def dump_do_aparelho() -> str:
    try:
        r = subprocess.run(["adb", "shell", "dumpsys", "shortcut"],
                           capture_output=True, timeout=120)
    except FileNotFoundError:
        sys.exit("adb não encontrado no PATH")
    if r.returncode != 0:
        sys.exit("adb falhou — o tablet está conectado e autorizado?")
    return r.stdout.decode("utf-8", errors="replace")


# telefone é o rótulo quando o contato NÃO está salvo na agenda
RE_FONE = re.compile(r"^\+?\d[\d\s\-\(\)]{7,}$")


def extrair(texto: str):
    """Devolve {lid: (nome, telefone)} — um dos dois vem nulo."""
    achados = {}
    for lid, rotulo in re.findall(
        r"ShortcutInfo \{id=([^,]+),.*?shortLabel=([^,]*?), resId", texto, re.S
    ):
        if not lid.endswith("@lid"):
            continue
        rotulo = (rotulo or "").strip()
        if not rotulo or rotulo == "null":
            continue
        if RE_FONE.match(rotulo):
            achados[lid] = (None, rotulo)
        else:
            achados[lid] = (rotulo, None)
    return achados


def rest(caminho: str, metodo="GET", corpo=None, prefer=None):
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/" + caminho
    chave = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    dados = json.dumps(corpo).encode() if corpo is not None else None
    req = urllib.request.Request(url, data=dados, method=metodo)
    req.add_header("apikey", chave)
    req.add_header("Authorization", f"Bearer {chave}")
    req.add_header("Content-Type", "application/json")
    if prefer:
        req.add_header("Prefer", prefer)
    with urllib.request.urlopen(req, timeout=60) as r:
        txt = r.read().decode()
        return json.loads(txt) if txt.strip() else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--arquivo", type=Path, help="usa um dump salvo em vez do aparelho")
    args = ap.parse_args()

    carregar_env()
    texto = args.arquivo.read_text(errors="replace") if args.arquivo else dump_do_aparelho()
    achados = extrair(texto)
    com_fone = sum(1 for n, f in achados.values() if f)
    print(f"atalhos LID encontrados: {len(achados)} "
          f"({com_fone} com telefone, {len(achados) - com_fone} com nome)")
    if not achados:
        return

    if args.dry_run:
        for lid, (nome, fone) in list(achados.items())[:5]:
            print(f"  {lid[:6]}…@lid -> {'nome' if nome else 'fone'}")
        print("(dry-run: nada gravado)")
        return

    # 1) o mapa de identidade da conversa
    linhas = []
    for lid, (nome, fone) in achados.items():
        so_digitos = re.sub(r"\D", "", fone) if fone else None
        linhas.append({
            "instance": INSTANCE,
            "lid": lid,
            "display_name": nome,
            "phone": fone,
            "jid": f"{so_digitos}@s.whatsapp.net" if so_digitos else None,
            "source": "shortcut",
        })
    rest("zap_jid_map?on_conflict=instance,lid", "POST", linhas,
         prefer="resolution=merge-duplicates")
    print(f"zap_jid_map: {len(linhas)} conversas gravadas")

    # 2) o rótulo que a lista de conversas exibe. Só preenche onde está vazio —
    #    nome vindo da notificação é melhor e não deve ser sobrescrito.
    preenchidas = 0
    for lid, (nome, fone) in achados.items():
        rotulo = nome or fone
        if not rotulo:
            continue
        rest(f"zap_messages?instance=eq.{INSTANCE}&remote_jid=eq.{lid}&push_name=is.null",
             "PATCH", {"push_name": rotulo}, prefer="return=minimal")
        preenchidas += 1
    print(f"push_name preenchido em {preenchidas} conversas")


if __name__ == "__main__":
    main()
