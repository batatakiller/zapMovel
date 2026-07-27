package com.zapmovel.agent;

import android.app.Notification;
import android.os.Bundle;
import android.os.Parcelable;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Lê as notificações do WhatsApp Business e manda para o ZapMóvel.
 *
 * O que dá para extrair (verificado neste aparelho):
 *   shortcutId  -> '<n>@lid', o mesmo identificador que o msgstore usa
 *   android.title             -> nome que o WhatsApp exibe (a única fonte de
 *                                nome para conversa LID — a agenda não tem)
 *   android.messages          -> MessagingStyle: texto, hora e remetente
 *   android.isGroupConversation
 *
 * O que NÃO dá: id real da mensagem, mídia, citação, status de entrega. Tudo
 * isso vem depois pelo msgstore, que corrige a linha usando a dedupe_key.
 */
public class WaNotificationListener extends NotificationListenerService {
    private static final String WA_BUSINESS = "com.whatsapp.w4b";
    private static final String WA_NORMAL = "com.whatsapp";

    private final ExecutorService pool = Executors.newSingleThreadExecutor();
    private Config cfg;
    private Sender sender;

    /**
     * Uma notificação MessagingStyle reenvia as últimas mensagens da conversa a
     * cada atualização. Sem esta memória, a mesma mensagem seria mandada muitas
     * vezes. O servidor também deduplica, mas evitar a requisição é melhor.
     */
    private final Map<String, Boolean> jaEnviadas =
        Collections.synchronizedMap(new LinkedHashMap<String, Boolean>(600, 0.75f, true) {
            @Override protected boolean removeEldestEntry(Map.Entry<String, Boolean> e) {
                return size() > 500;
            }
        });

    @Override public void onCreate() {
        super.onCreate();
        cfg = new Config(this);
        sender = new Sender(cfg);
    }

    @Override public void onListenerConnected() {
        Log.i(Sender.TAG, "listener conectado ao sistema");
    }

    @Override public void onNotificationPosted(StatusBarNotification sbn) {
        final String pkg = sbn.getPackageName();
        if (!WA_BUSINESS.equals(pkg) && !WA_NORMAL.equals(pkg)) return;

        final Notification n = sbn.getNotification();
        if (n == null) return;
        // O resumo do grupo repete o que já vem nas notificações individuais.
        if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) {
            Log.d(Sender.TAG, "ignorando resumo de grupo");
            return;
        }

        final Bundle extras = n.extras;
        if (extras == null) return;

        // Sem shortcutId não há como saber de qual conversa é — e um jid
        // inventado bagunçaria a caixa de entrada. Melhor descartar.
        final String jid = sbn.getNotification().getShortcutId();
        Log.i(Sender.TAG, "notificacao de " + pkg + " shortcutId=" + jid
              + " temMessages=" + (extras.getParcelableArray(Notification.EXTRA_MESSAGES) != null));
        if (jid == null || jid.isEmpty()) {
            Log.w(Sender.TAG, "sem shortcutId — descartada");
            return;
        }

        final String titulo = texto(extras.getCharSequence(Notification.EXTRA_TITLE));
        final boolean grupo = extras.getBoolean("android.isGroupConversation", false);
        final Parcelable[] msgs = extras.getParcelableArray(Notification.EXTRA_MESSAGES);
        final long quando = n.when > 0 ? n.when : System.currentTimeMillis();

        pool.execute(() -> processar(jid, titulo, grupo, msgs, extras, quando));
    }

    private void processar(String jid, String titulo, boolean grupo,
                           Parcelable[] msgs, Bundle extras, long quando) {
        List<String> lote = new ArrayList<>();

        if (msgs != null && msgs.length > 0) {
            for (Parcelable p : msgs) {
                if (!(p instanceof Bundle)) continue;
                Bundle b = (Bundle) p;
                String texto = texto(b.getCharSequence("text"));
                if (texto.isEmpty()) continue;
                long ts = b.getLong("time", quando);
                // Em grupo, 'sender' é quem falou; em conversa individual vem
                // nulo e o nome da conversa é o próprio título.
                String remetente = texto(b.getCharSequence("sender"));
                String nome = grupo ? titulo : (remetente.isEmpty() ? titulo : remetente);
                adicionar(lote, jid, nome, texto, ts, grupo);
            }
        } else {
            // Notificação sem MessagingStyle: sobra o texto simples.
            String texto = texto(extras.getCharSequence(Notification.EXTRA_TEXT));
            if (!texto.isEmpty()) adicionar(lote, jid, titulo, texto, quando, grupo);
        }

        Log.i(Sender.TAG, "conversa " + jid + " -> " + lote.size() + " mensagem(ns) nova(s)");
        if (!lote.isEmpty()) sender.send(lote);
    }

    private void adicionar(List<String> lote, String jid, String nome,
                           String texto, long ts, boolean grupo) {
        String chave = dedupeKey(jid, ts, false, texto);
        if (jaEnviadas.put(chave, Boolean.TRUE) != null) return; // já foi

        StringBuilder j = new StringBuilder();
        j.append('{')
         .append(campo("instance", cfg.instance())).append(',')
         .append(campo("remote_jid", jid)).append(',')
         // prefixo 'nl:' identifica id sintético; o msgstore troca pelo real
         .append(campo("message_id", "nl:" + chave.substring(0, 16))).append(',')
         .append("\"from_me\":false,")
         .append(campo("push_name", nome)).append(',')
         .append(campo("type", "text")).append(',')
         .append(campo("content", texto)).append(',')
         .append(campo("status", "received")).append(',')
         .append("\"msg_timestamp\":").append(ts).append(',')
         .append("\"quoted_message_id\":null,")
         .append(campo("dedupe_key", chave)).append(',')
         .append(campo("origin", "notif")).append(',')
         .append("\"media_path\":null,\"mime_type\":null,\"sender_jid\":null,\"phone\":null,")
         .append("\"is_group\":").append(grupo)
         .append('}');
        lote.add(j.toString());
    }

    /**
     * Precisa bater byte a byte com dedupe_key() do sync_msgstore.py:
     *   sha1("<jid>|<segundos>|<0 ou 1>|<texto sem espaços nas pontas>")
     * Se divergir, a mesma mensagem entra duas vezes na conversa — uma pela
     * notificação e outra pelo msgstore.
     */
    static String dedupeKey(String jid, long tsMillis, boolean fromMe, String texto) {
        String base = jid + "|" + (tsMillis / 1000L) + "|" + (fromMe ? 1 : 0) + "|" + texto.trim();
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] h = md.digest(base.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(40);
            for (byte x : h) sb.append(Character.forDigit((x >> 4) & 0xF, 16))
                               .append(Character.forDigit(x & 0xF, 16));
            return sb.toString();
        } catch (Exception e) {
            Log.e(Sender.TAG, "sha1 indisponível", e);
            return Integer.toHexString(base.hashCode());
        }
    }

    private static String texto(CharSequence cs) {
        return cs == null ? "" : cs.toString();
    }

    private static String campo(String nome, String valor) {
        return "\"" + nome + "\":" + (valor == null ? "null" : "\"" + escapar(valor) + "\"");
    }

    private static String escapar(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 16);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n");  break;
                case '\r': sb.append("\\r");  break;
                case '\t': sb.append("\\t");  break;
                default:
                    // caracteres de controle precisam virar escape unicode
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.toString();
    }
}
