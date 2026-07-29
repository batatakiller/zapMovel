#!/data/data/com.termux/files/usr/bin/bash
# Instala o ciclo de sincronização do msgstore dentro do Termux.
#
# Rode UMA vez, dentro do Termux:
#     bash /sdcard/zapmovel/setup.sh
#
# Depois disso o tablet passa a processar sozinho os backups do MIUI e enviar
# as mensagens ao ZapMóvel, sem PC e sem cabo.
set -e

CASA="$HOME/zapmovel"
ENV="$HOME/.zapmovel_sync.env"
ORIGEM="/sdcard/zapmovel"

echo "==> conferindo acesso ao armazenamento"
if [ ! -d /sdcard ]; then
  echo "ERRO: o Termux não enxerga /sdcard."
  echo "Rode primeiro:  termux-setup-storage   (e aceite a permissão)"
  exit 1
fi
if [ ! -f "$ORIGEM/sync_msgstore.py" ]; then
  echo "ERRO: não achei $ORIGEM/sync_msgstore.py"
  exit 1
fi

echo "==> instalando python (pode demorar na primeira vez)"
pkg install -y python >/dev/null

echo "==> copiando os scripts"
mkdir -p "$CASA"
cp "$ORIGEM/sync_msgstore.py" "$CASA/"
# upload_media.py faltava aqui: sem ele o ciclo trazia a mensagem mas nunca o
# arquivo, e toda foto virava bolha "📷 Foto" vazia
cp "$ORIGEM/upload_media.py" "$CASA/"
cp "$ORIGEM/loop.sh" "$CASA/"
chmod +x "$CASA/loop.sh"

if [ -f "$ENV" ]; then
  echo "==> configuração já existe, mantendo"
else
  echo
  echo "Cole o ANDROID_INGEST_TOKEN (o mesmo que está no app ZapMóvel Agente)"
  echo "e tecle Enter. Ele não aparece na tela:"
  read -r -s TOKEN
  if [ -z "$TOKEN" ]; then echo "token vazio, abortando"; exit 1; fi
  cat > "$ENV" <<FIM
ZAP_API_URL=https://zapmovel.vercel.app
ZAP_API_TOKEN=$TOKEN
ZAP_INSTANCE=tablet-loja
FIM
  # o token fica legível só para o próprio usuário do Termux
  chmod 600 "$ENV"
  echo "==> configuração gravada"
fi

echo
echo "==> teste rápido (não envia nada)"
python "$CASA/sync_msgstore.py" --dry-run --limit 5 || {
  echo
  echo "O teste falhou. Causas comuns:"
  echo "  - nenhum backup em /sdcard/MIUI/backup/AllBackup"
  echo "  - falta permissão de armazenamento (rode termux-setup-storage)"
  exit 1
}

echo
echo "Tudo pronto."
echo
echo "Para iniciar o ciclo agora:"
echo "    ~/zapmovel/loop.sh &"
echo
echo "Para acompanhar:"
echo "    tail -f ~/zapmovel/sync.log"
