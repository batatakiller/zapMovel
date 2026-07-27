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

# Sem isto a Android suspende o processo quando a tela apaga e o ciclo
# simplesmente para — sem erro, o que torna a falha difícil de perceber.
termux-wake-lock 2>/dev/null || log "aviso: termux-wake-lock indisponível (instale o Termux:API)"

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
      log "concluído"
    else
      # não marca: a próxima volta tenta de novo. O estado por _id faz o
      # reenvio retomar de onde parou, sem duplicar.
      log "FALHOU — tentará de novo na próxima volta"
    fi
  fi

  sleep "$INTERVALO"
done
