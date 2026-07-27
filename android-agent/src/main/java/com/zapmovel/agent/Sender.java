package com.zapmovel.agent;

import android.util.Log;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;

/** Envia lotes para /api/ingest/android. */
public class Sender {
    static final String TAG = "ZapAgent";

    private final Config cfg;

    public Sender(Config cfg) {
        this.cfg = cfg;
    }

    /**
     * Manda as mensagens. Devolve true se o servidor aceitou.
     *
     * Não guardamos fila em disco: se falhar, a mensagem não se perde de
     * verdade — o msgstore a traz no próximo backup, com id real e tudo mais.
     * A notificação é a via rápida, não a via confiável.
     */
    public boolean send(List<String> jsonMessages) {
        if (jsonMessages.isEmpty()) return true;
        if (!cfg.isComplete()) {
            cfg.recordError("configuração incompleta");
            return false;
        }

        StringBuilder body = new StringBuilder("{\"messages\":[");
        for (int i = 0; i < jsonMessages.size(); i++) {
            if (i > 0) body.append(',');
            body.append(jsonMessages.get(i));
        }
        body.append("]}");

        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(cfg.url() + "/api/ingest/android").openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + cfg.token());
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setDoOutput(true);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                cfg.recordSent(jsonMessages.size());
                Log.i(TAG, "enviadas " + jsonMessages.size() + " mensagens");
                return true;
            }
            cfg.recordError("HTTP " + code);
            Log.w(TAG, "servidor respondeu " + code);
            return false;
        } catch (Exception e) {
            cfg.recordError(e.getClass().getSimpleName() + ": " + e.getMessage());
            Log.w(TAG, "falha ao enviar", e);
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
