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

    /** Evita subir o mesmo arquivo a cada atualização da notificação. */
    private final Map<String, Boolean> midiaEnviada =
        Collections.synchronizedMap(new LinkedHashMap<String, Boolean>(200, 0.75f, true) {
            @Override protected boolean removeEldestEntry(Map.Entry<String, Boolean> e) {
                return size() > 150;
            }
        });

    private OutboxPoller poller;
    private MediaUploader uploader;
    private java.util.concurrent.ScheduledExecutorService agenda;

    @Override public void onCreate() {
        super.onCreate();
        cfg = new Config(this);
        sender = new Sender(cfg);
        poller = new OutboxPoller(this, cfg);
        uploader = new MediaUploader(this, cfg);

        // O ciclo da fila vive junto com o listener: os dois dependem das mesmas
        // notificações, e um serviço só é mais simples de manter vivo na MIUI do
        // que dois. 10s é um meio-termo entre resposta rápida e tráfego à toa.
        agenda = java.util.concurrent.Executors.newSingleThreadScheduledExecutor();
        agenda.scheduleWithFixedDelay(() -> {
            try {
                poller.ciclo();
            } catch (Throwable t) {
                Log.w(Sender.TAG, "ciclo abortou: " + t.getMessage());
            }
        }, 5, 10, java.util.concurrent.TimeUnit.SECONDS);
    }

    @Override public void onDestroy() {
        if (agenda != null) agenda.shutdownNow();
        super.onDestroy();
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

        // Guarda a ação "Responder" desta conversa antes de qualquer coisa: é o
        // que permite enviar depois, e ela só existe enquanto a notificação vive.
        ReplyRegistry.registrar(jid, n);

        final String titulo = texto(extras.getCharSequence(Notification.EXTRA_TITLE));
        final boolean grupo = extras.getBoolean("android.isGroupConversation", false);
        final Parcelable[] msgs = extras.getParcelableArray(Notification.EXTRA_MESSAGES);
        final long quando = n.when > 0 ? n.when : System.currentTimeMillis();

        pool.execute(() -> processar(jid, titulo, grupo, msgs, extras, quando));
    }

    private void processar(String jid, String titulo, boolean grupo,
                           Parcelable[] msgs, Bundle extras, long quando) {
        List<String> lote = new ArrayList<>();
        List<Object[]> pendentes = new ArrayList<>();

        if (msgs != null && msgs.length > 0) {
            for (Parcelable p : msgs) {
                if (!(p instanceof Bundle)) continue;
                Bundle b = (Bundle) p;
                // O MessagingStyle traz a mídia em "uri" + "type" — é a própria
                // notificação dizendo qual arquivo é o da mensagem, sem precisar
                // vasculhar /sdcard e adivinhar pelo horário.
                String mime = b.getString("type");
                android.net.Uri uri = b.getParcelable("uri");

                String texto = texto(b.getCharSequence("text"));
                if (texto.isEmpty() && uri == null) continue;
                long ts = b.getLong("time", quando);

                // O MessagingStyle marca como remetente APENAS o outro lado:
                // mensagem sua entra sem "sender" e sem "sender_person". Depois
                // de responder pelo ZapMóvel, o WhatsApp reescreve a notificação
                // incluindo a sua resposta — sem esta checagem ela voltava para
                // o banco como recebida e a conversa mostrava tudo duas vezes.
                boolean minha = !b.containsKey("sender_person") && !b.containsKey("sender");
                if (minha) {
                    Log.d(Sender.TAG, "ignorando eco da minha propria mensagem");
                    continue;
                }

                String remetente = texto(b.getCharSequence("sender"));
                String nome = grupo ? titulo : (remetente.isEmpty() ? titulo : remetente);

                if (uri != null && mime != null) {
                    String[] r = rotulo(mime);
                    // O WhatsApp já põe em `text` a legenda quando existe, ou o
                    // próprio rótulo ("📷 Foto") quando não existe. Concatenar
                    // gerava "📷 Foto — 📷 Foto"; usar o texto como veio resolve.
                    String conteudo = texto.isEmpty() ? r[1] : texto;
                    // texto VAZIO na chave: o msgstore deixa text_data nulo em
                    // quase toda mídia, e usar o rótulo aqui faria a mesma foto
                    // entrar duas vezes — uma por camada.
                    String msgId = adicionar(lote, jid, nome, conteudo, ts, grupo, r[0], "");
                    if (msgId != null && midiaEnviada.put(msgId, Boolean.TRUE) == null) {
                        pendentes.add(new Object[]{msgId, uri, mime});
                    }
                } else {
                    adicionar(lote, jid, nome, texto, ts, grupo, "text", texto);
                }
            }
        } else {
            // Notificação sem MessagingStyle: sobra o texto simples.
            String texto = texto(extras.getCharSequence(Notification.EXTRA_TEXT));
            if (!texto.isEmpty()) adicionar(lote, jid, titulo, texto, quando, grupo, "text", texto);
        }

        Log.i(Sender.TAG, "conversa " + jid + " -> " + lote.size() + " mensagem(ns) nova(s)");
        if (!lote.isEmpty() && !sender.send(lote)) return;

        // Só depois da mensagem existir no banco: o upload precisa de uma linha
        // para marcar, senão o arquivo fica órfão no bucket.
        for (Object[] p : pendentes) {
            uploader.enviar((String) p[0], (android.net.Uri) p[1], (String) p[2]);
        }
    }

    private String adicionar(List<String> lote, String jid, String nome,
                             String conteudo, long ts, boolean grupo,
                             String tipo, String textoParaChave) {
        // A chave usa o texto puro (legenda, ou vazio), não o rótulo com emoji:
        // é assim que o msgstore a calcula, e as duas precisam coincidir.
        String chave = dedupeKey(jid, ts, false, textoParaChave);
        String msgId = "nl:" + chave.substring(0, 16);
        // Devolve o id mesmo quando a mensagem já foi enviada: a notificação de
        // uma foto chega duas vezes — primeiro sem a mídia, depois com ela — e
        // é na segunda que temos o arquivo. Sair aqui perderia a imagem.
        if (jaEnviadas.put(chave, Boolean.TRUE) != null) return msgId;

        StringBuilder j = new StringBuilder();
        j.append('{')
         .append(campo("instance", cfg.instance())).append(',')
         .append(campo("remote_jid", jid)).append(',')
         // prefixo 'nl:' identifica id sintético; o msgstore troca pelo real
         .append(campo("message_id", "nl:" + chave.substring(0, 16))).append(',')
         .append("\"from_me\":false,")
         .append(campo("push_name", nome)).append(',')
         .append(campo("type", tipo)).append(',')
         .append(campo("content", conteudo)).append(',')
         .append(campo("status", "received")).append(',')
         .append("\"msg_timestamp\":").append(ts).append(',')
         .append("\"quoted_message_id\":null,")
         .append(campo("dedupe_key", chave)).append(',')
         .append(campo("origin", "notif")).append(',')
         .append("\"media_path\":null,\"mime_type\":null,\"sender_jid\":null,\"phone\":null,")
         .append("\"is_group\":").append(grupo)
         .append('}');
        lote.add(j.toString());
        return msgId;
    }

    /** message_type do WhatsApp não vem na notificação; deduzimos pelo mime. */
    private static String[] rotulo(String mime) {
        if (mime.startsWith("image/webp")) return new String[]{"sticker", "💟 Figurinha"};
        if (mime.startsWith("image/"))     return new String[]{"image", "📷 Foto"};
        if (mime.startsWith("video/"))     return new String[]{"video", "🎬 Vídeo"};
        if (mime.startsWith("audio/"))     return new String[]{"audio", "🎤 Áudio"};
        return new String[]{"document", "📄 Documento"};
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
