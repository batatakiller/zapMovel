package com.zapmovel.agent;

import android.content.ContentResolver;
import android.content.Context;
import android.net.Uri;
import android.util.Log;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Sobe a mídia da mensagem para o ZapMóvel.
 *
 * A notificação do WhatsApp traz a imagem em MessagingStyle como `uri` + `type`
 * (verificado: `type=image/jpeg uri=true`). Isso evita ter que vasculhar
 * /sdcard e adivinhar, pelo horário, qual arquivo pertence a qual mensagem — a
 * própria notificação diz.
 *
 * A URI é um `content://` do WhatsApp, legível porque a notificação concede
 * permissão temporária a quem a recebe.
 */
public class MediaUploader {
    // acima disso não vale a pena: consome cota e demora no 4G do tablet
    private static final int LIMITE_BYTES = 12 * 1024 * 1024;

    private final Context ctx;
    private final Config cfg;

    public MediaUploader(Context ctx, Config cfg) {
        this.ctx = ctx;
        this.cfg = cfg;
    }

    /** Lê a URI e envia. Devolve true se o servidor aceitou. */
    public boolean enviar(String messageId, Uri uri, String mime) {
        if (!cfg.isComplete() || uri == null) return false;
        HttpURLConnection conn = null;
        try {
            ContentResolver cr = ctx.getContentResolver();
            byte[] dados;
            try (InputStream in = cr.openInputStream(uri)) {
                if (in == null) {
                    Log.w(Sender.TAG, "não consegui abrir a mídia: " + uri);
                    return false;
                }
                dados = lerTudo(in, LIMITE_BYTES);
            }
            if (dados == null) {
                Log.i(Sender.TAG, "mídia acima do limite, ignorada: " + messageId);
                return false;
            }

            conn = (HttpURLConnection) new URL(cfg.url() + "/api/ingest/media").openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", mime != null ? mime : "application/octet-stream");
            conn.setRequestProperty("Authorization", "Bearer " + cfg.token());
            conn.setRequestProperty("x-message-id", messageId);
            conn.setRequestProperty("x-instance", cfg.instance());
            // ver Sender: conexão reaproveitada morre contra a Vercel
            conn.setRequestProperty("Connection", "close");
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(60000);
            conn.setDoOutput(true);
            conn.setFixedLengthStreamingMode(dados.length);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(dados);
            }
            int code = conn.getResponseCode();
            boolean ok = code >= 200 && code < 300;
            Log.i(Sender.TAG, "midia " + messageId + " -> HTTP " + code
                  + " (" + dados.length / 1024 + " KB)");
            return ok;
        } catch (SecurityException e) {
            // a permissão da notificação expirou antes de lermos
            Log.w(Sender.TAG, "sem permissão para ler a mídia: " + e.getMessage());
            return false;
        } catch (Exception e) {
            Log.w(Sender.TAG, "falha ao subir mídia: " + e.getMessage());
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** Lê tudo até o limite; devolve null se estourar (sem carregar o resto). */
    private static byte[] lerTudo(InputStream in, int limite) throws Exception {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
            if (out.size() > limite) return null;
        }
        return out.toByteArray();
    }
}
