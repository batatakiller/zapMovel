package com.zapmovel.agent;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Guarda a ação "Responder" de cada conversa, tirada da notificação.
 *
 * Limite que vem do Android, não do nosso código: essa ação só vale enquanto a
 * notificação existe. Se você abrir a conversa no tablet, ou descartar a
 * notificação, o PendingIntent é cancelado e não há como responder por ele —
 * o envio falha e volta para a fila.
 */
public class ReplyRegistry {
    private static final Map<String, Entrada> porJid =
        Collections.synchronizedMap(new LinkedHashMap<String, Entrada>(80, 0.75f, true) {
            @Override protected boolean removeEldestEntry(Map.Entry<String, Entrada> e) {
                return size() > 60;
            }
        });

    static class Entrada {
        final PendingIntent intent;
        final RemoteInput[] inputs;
        Entrada(PendingIntent i, RemoteInput[] r) { intent = i; inputs = r; }
    }

    /** Procura a ação com campo de texto (a de responder) e a memoriza. */
    static void registrar(String jid, Notification n) {
        if (n.actions == null) return;
        for (Notification.Action a : n.actions) {
            RemoteInput[] inputs = a.getRemoteInputs();
            if (inputs != null && inputs.length > 0 && a.actionIntent != null) {
                porJid.put(jid, new Entrada(a.actionIntent, inputs));
                return;
            }
        }
    }

    static boolean temResposta(String jid) {
        return porJid.containsKey(jid);
    }

    /**
     * Dispara a resposta. Devolve null em caso de sucesso, ou o motivo da
     * falha — que o agente repassa ao servidor para você ver no app.
     */
    static String responder(Context ctx, String jid, String texto) {
        Entrada e = porJid.get(jid);
        if (e == null) {
            return "sem notificação ativa desta conversa";
        }
        try {
            Intent intent = new Intent();
            Bundle valores = new Bundle();
            for (RemoteInput ri : e.inputs) {
                valores.putCharSequence(ri.getResultKey(), texto);
            }
            RemoteInput.addResultsToIntent(e.inputs, intent, valores);
            // Sem isso o WhatsApp pode tratar a resposta como digitação parcial
            // em vez de mensagem pronta para enviar.
            RemoteInput.setResultsSource(intent, RemoteInput.SOURCE_FREE_FORM_INPUT);
            e.intent.send(ctx, 0, intent);
            Log.i(Sender.TAG, "resposta enviada para " + jid);
            return null;
        } catch (PendingIntent.CanceledException ex) {
            // notificação já foi embora — o WhatsApp cancelou o intent
            porJid.remove(jid);
            return "notificação expirou (conversa aberta ou descartada no aparelho)";
        } catch (Exception ex) {
            return ex.getClass().getSimpleName() + ": " + ex.getMessage();
        }
    }
}
