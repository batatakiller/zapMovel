package com.zapmovel.agent;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Puxa a fila de saída do ZapMóvel e responde pela notificação.
 *
 * O aparelho puxa em vez de receber porque não tem endereço fixo nem porta
 * aberta — e porque assim o envio continua funcionando atrás de qualquer rede.
 */
public class OutboxPoller {
    private final Context ctx;
    private final Config cfg;

    public OutboxPoller(Context ctx, Config cfg) {
        this.ctx = ctx;
        this.cfg = cfg;
    }

    /** Um ciclo: pega o que está na fila, envia e confirma. */
    public void ciclo() {
        if (!cfg.isComplete()) return;
        try {
            JSONArray itens = pegarFila();
            for (int i = 0; i < itens.length(); i++) {
                JSONObject item = itens.getJSONObject(i);
                long id = item.getLong("id");
                String jid = item.getString("remote_jid");
                String texto = item.optString("content", "");

                String erro = null;
                if (ReplyRegistry.temResposta(jid)) {
                    erro = ReplyRegistry.responder(ctx, jid, texto);
                } else if (jid.endsWith("@lid")) {
                    erro = "Sem notificação ativa para ID interno (@lid). Aguarde o cliente enviar uma nova mensagem.";
                } else if (WaAccessibilityService.isRunning()) {
                    Log.i(Sender.TAG, "Sem notificação para " + jid + ". Usando fallback de Acessibilidade...");
                    erro = WaAccessibilityService.enviarViaAcessibilidade(ctx, jid, texto);
                } else {
                    erro = "sem notificação ativa e serviço de acessibilidade desativado no aparelho";
                }
                confirmar(id, erro == null, erro);

                // Intervalo entre mensagens: disparo em rajada é o padrão que
                // mais chama atenção do WhatsApp, e foi o que gerou as
                // suspensões que motivaram este projeto.
                if (i < itens.length() - 1) {
                    Thread.sleep(3000 + (long) (Math.random() * 4000));
                }
            }
        } catch (Exception e) {
            Log.w(Sender.TAG, "ciclo da fila falhou: " + e.getMessage());
        }
    }

    private JSONArray pegarFila() throws Exception {
        HttpURLConnection c = abrir("/api/outbox/next");
        c.setDoOutput(true);
        try (OutputStream os = c.getOutputStream()) {
            String body = "{\"instance\":\"" + cfg.instance() + "\",\"limit\":5}";
            os.write(body.getBytes(StandardCharsets.UTF_8));
        }
        if (c.getResponseCode() != 200) {
            c.disconnect();
            return new JSONArray();
        }
        String resp = ler(c);
        c.disconnect();
        return new JSONObject(resp).optJSONArray("items") != null
            ? new JSONObject(resp).getJSONArray("items")
            : new JSONArray();
    }

    private void confirmar(long id, boolean ok, String erro) {
        try {
            HttpURLConnection c = abrir("/api/outbox/ack");
            c.setDoOutput(true);
            JSONObject b = new JSONObject();
            b.put("id", id);
            b.put("ok", ok);
            if (erro != null) b.put("error", erro);
            try (OutputStream os = c.getOutputStream()) {
                os.write(b.toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = c.getResponseCode();
            Log.i(Sender.TAG, "ack para item " + id + " (ok=" + ok + "): HTTP " + code);
            c.disconnect();
        } catch (Exception e) {
            Log.w(Sender.TAG, "ack falhou: " + e.getMessage());
        }
    }

    private HttpURLConnection abrir(String caminho) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(cfg.url() + caminho).openConnection();
        c.setRequestMethod("POST");
        c.setRequestProperty("Content-Type", "application/json");
        c.setRequestProperty("Authorization", "Bearer " + cfg.token());
        // ver comentário em Sender: sem isso, conexão reaproveitada morre
        c.setRequestProperty("Connection", "close");
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        return c;
    }

    private static String ler(HttpURLConnection c) throws Exception {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(
                new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
            String linha;
            while ((linha = r.readLine()) != null) sb.append(linha);
        }
        return sb.toString();
    }
}
