#!/data/data/com.termux/files/usr/bin/bash
# Ciclo de sincronização do msgstore. Roda dentro do Termux, no tablet.
#
#     ~/zapmovel/loop.sh &        inicia
#     tail -f ~/zapmovel/sync.log acompanha
#     pkill -f loop.sh            para
#
# Só processa quando aparece um backup NOVO. Reprocessar o mesmo arquivo não
# traria nada — o estado por _id já garante isso — mas custaria alguns minutos
# de CPU e bateria à toa a cada volta.

CASA="$HOME/zapmovel"
LOG="$CASA/sync.log"
MARCA="$CASA/.ultimo_backup"
PASTA_BACKUP="/sdcard/MIUI/backup/AllBackup"
INTERVALO=1800   # 30 min entre verificações

log() { echo "[$(date '+%d/%m %H:%M:%S')] $*" >> "$LOG"; }

# Sem wake lock a Android suspende o processo quando a tela apaga e o ciclo
# para — sem erro. Foi exatamente o que aconteceu em 27/07/2026: o ciclo subiu,
# rodou algumas voltas e morreu calado; ninguém percebeu por dois dias, e nesse
# intervalo mensagem e foto se perderam. Por isso aqui isso GRITA em vez de
# virar uma linha de aviso no meio do log.
if ! termux-wake-lock 2>/dev/null; then
  cat <<'AVISO'

  ┌───────────────────────────────────────────────────────────────┐
  │  SEM WAKE LOCK — este ciclo VAI morrer quando a tela apagar.   │
  │                                                               │
  │  Resolva de um dos dois jeitos, agora:                        │
  │                                                               │
  │  1) Puxe a barra de notificações, abra a do Termux e toque    │
  │     em "ACQUIRE WAKELOCK". Funciona sem instalar nada.        │
  │                                                               │
  │  2) Instale o Termux:API (app + `pkg install termux-api`)     │
  │     e este script passa a segurar o wake lock sozinho.        │
  └───────────────────────────────────────────────────────────────┘

AVISO
  log "SEM WAKE LOCK — o ciclo morre quando a tela apagar"
fi

log "ciclo iniciado (verifica a cada $((INTERVALO / 60)) min)"

while true; do
  ultimo=$(ls -t "$PASTA_BACKUP"/*.zip 2>/dev/null | head -1)

  if [ -z "$ultimo" ]; then
    log "nenhum backup em $PASTA_BACKUP"
  elif [ -f "$MARCA" ] && [ "$(cat "$MARCA")" = "$ultimo" ]; then
    : # mesmo backup da última volta, nada novo a fazer
  else
    log "processando $(basename "$ultimo")"
    if python "$CASA/sync_msgstore.py" --zip "$ultimo" >> "$LOG" 2>&1; then
      echo "$ultimo" > "$MARCA"
      # A mensagem sozinha não basta: sem este passo a foto fica como bolha
      # "📷 Foto" sem arquivo, que era o sintoma que trouxe todo mundo aqui. O
      # sync grava o caminho em raw.media_path e é este script que lê o arquivo
      # em /sdcard e o envia. Falhar aqui não desmarca o backup — a mensagem já
      # entrou, e o pendente é recuperado na próxima volta pela consulta de
      # /pendentes, que ignora o que já está no bucket.
      python "$CASA/upload_media.py" --dias 7 >> "$LOG" 2>&1 \
        || log "aviso: upload de mídia falhou — tentará na próxima volta"
      log "concluído"
    else
      # não marca: a próxima volta tenta de novo. O estado por _id faz o
      # reenvio retomar de onde parou, sem duplicar.
      log "FALHOU — tentará de novo na próxima volta"
    fi
  fi

  sleep "$INTERVALO"
done
