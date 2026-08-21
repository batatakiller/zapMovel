#!/usr/bin/env python3
"""
Sobe para o ZapMóvel a mídia que ficou só registrada, sem arquivo.

Existe porque a notificação é a única fonte que traz a mídia junto — e ela só
cobre o que chegou com o agente rodando e com notificação gerada. Mensagem que
chegou com a conversa aberta no tablet, ou enquanto o serviço estava parado,
fica com a bolha "📷 Foto" e nenhum arquivo.

Este script fecha esse buraco pelo outro lado: o msgstore grava em
`raw.media_path` onde o arquivo está no aparelho, e aqui ele é lido de /sdcard
e enviado para a mesma rota que a notificação usa.

Roda no tablet (Termux), onde /sdcard está acessível.

Uso:
    python upload_media.py                    # pendências dos últimos 7 dias
    python upload_media.py --dias 30          # janela maior
    python upload_media.py --tipos image,document
    python upload_media.py --dry-run          # só lista
"""

import argparse
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ENV = Path.home() / ".zapmovel_sync.env"
ENV_LOCAL = Path(__file__).resolve().parent.parent.parent / ".env.local"

# a pasta muda de nome conforme a variante do app instalada
RAIZES = [
    Path("/sdcard/Android/media/com.whatsapp.w4b/WhatsApp Business"),
    Path("/sdcard/Android/media/com.whatsapp/WhatsApp"),
]
LIMITE_BYTES = 12 * 1024 * 1024  # igual ao aceito pelo servidor


def carregar_env():
    # 1. Tenta ~/.zapmovel_sync.env (Termux)
    if ENV.exists():
        for linha in ENV.read_text().splitlines():
            if linha.strip() and not linha.startswith("#") and "=" in linha:
                k, v = linha.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip("\"'"))

    # 2. Tenta .env.local (Mac / PC)
    if ENV_LOCAL.exists():
        for linha in ENV_LOCAL.read_text().splitlines():
            if linha.strip() and not linha.startswith("#") and "=" in linha:
                k, v = linha.split("=", 1)
                k = k.strip()
                v = v.strip().strip("\"'")
                if k == "ANDROID_INGEST_TOKEN":
                    os.environ.setdefault("ZAP_API_TOKEN", v)
                elif k == "NEXT_PUBLIC_APP_URL" or k == "VERCEL_URL":
                    os.environ.setdefault("ZAP_API_URL", v)

    os.environ.setdefault("ZAP_API_URL", "https://zapmovel.vercel.app")
    os.environ.setdefault("ZAP_INSTANCE", "tablet-loja")

    faltando = [k for k in ("ZAP_API_URL", "ZAP_API_TOKEN", "ZAP_INSTANCE") if not os.environ.get(k)]
    if faltando:
        sys.exit(f"faltam variáveis: {', '.join(faltando)}")


def ler_bytes_adb(media_path: str):
    """Lê os bytes diretamente do aparelho conectado via ADB."""
    import subprocess
    rel = media_path[media_path.index("Media/"):] if "Media/" in media_path else media_path
    for raiz in RAIZES:
        caminho_remoto = f"{raiz}/{rel}"
        try:
            res = subprocess.run(
                ["adb", "exec-out", f"cat \"{caminho_remoto}\""],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                check=False
            )
            # Se retornou dados com tamanho razoável e não é mensagem de erro do shell
            if res.stdout and len(res.stdout) > 0 and not res.stdout.startswith(b"/system/bin/sh:"):
                return res.stdout
        except Exception:
            pass
    return None


def resolver(media_path: str, raizes=None):
    """Acha o arquivo real a partir do caminho gravado pelo WhatsApp."""
    if not media_path:
        return None
    p = Path(media_path)
    if p.is_absolute() and p.exists():
        return p
    # o caminho costuma vir como 'Media/WhatsApp Business Images/IMG-....jpg'
    rel = media_path[media_path.index("Media/"):] if "Media/" in media_path else media_path
    for raiz in raizes or RAIZES:
        alvo = raiz / rel
        if alvo.exists():
            return alvo
    return None


def pendentes(api, token, instance, dias, tipos, limite):
    url = (
        f"{api}/api/ingest/media/pendentes"
        f"?instance={instance}&dias={dias}&tipos={','.join(tipos)}&limite={limite}"
    )
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode()).get("items", [])


def enviar_dados(api, token, instance, message_id, dados: bytes, nome_arquivo: str):
    mime = mimetypes.guess_type(nome_arquivo)[0] or "application/octet-stream"
    if len(dados) > LIMITE_BYTES:
        return False, f"{len(dados)/1e6:.1f} MB acima do limite"
    req = urllib.request.Request(f"{api}/api/ingest/media", data=dados, method="POST")
    req.add_header("Content-Type", mime)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("x-message-id", message_id)
    req.add_header("x-instance", instance)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return 200 <= r.status < 300, f"HTTP {r.status}"
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except Exception as e:
        return False, str(e)


def enviar(api, token, instance, message_id, arquivo: Path):
    return enviar_dados(api, token, instance, message_id, arquivo.read_bytes(), arquivo.name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dias", type=int, default=7)
    ap.add_argument("--tipos", default="image,document,audio,sticker",
                    help="vídeo fica de fora por padrão: é o que mais consome cota")
    ap.add_argument("--limite", type=int, default=200)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--raiz", type=Path, action="append",
                    help="raiz alternativa da pasta de mídia.")
    args = ap.parse_args()

    carregar_env()
    api = os.environ["ZAP_API_URL"].rstrip("/")
    token = os.environ["ZAP_API_TOKEN"]
    instance = os.environ["ZAP_INSTANCE"]
    tipos = [t.strip() for t in args.tipos.split(",") if t.strip()]

    itens = pendentes(api, token, instance, args.dias, tipos, args.limite)
    print(f"mensagens de mídia sem arquivo (últimos {args.dias} dias): {len(itens)}")
    if not itens:
        return

    enviados = sem_arquivo = falhas = 0
    for it in itens:
        media_path = it.get("media_path")
        arquivo = resolver(media_path, args.raiz)
        dados = None
        nome_arquivo = Path(media_path).name if media_path else f"{it['message_id']}.jpg"

        if arquivo and arquivo.exists():
            dados = arquivo.read_bytes()
        elif media_path:
            dados = ler_bytes_adb(media_path)

        if not dados:
            sem_arquivo += 1
            continue
        if args.dry_run:
            enviados += 1
            continue
        ok, detalhe = enviar_dados(api, token, instance, it["message_id"], dados, nome_arquivo)
        if ok:
            enviados += 1
        else:
            falhas += 1
            print(f"  falhou {it['message_id']}: {detalhe}")

    rotulo = "seriam enviados" if args.dry_run else "enviados"
    print(f"{rotulo}: {enviados} | arquivo ausente no aparelho: {sem_arquivo} | falhas: {falhas}")
    if sem_arquivo:
        print("(arquivo ausente = o WhatsApp já apagou do aparelho, ou a mídia nunca foi baixada)")


if __name__ == "__main__":
    main()
