package com.zapmovel.agent;

import android.content.Context;
import android.content.SharedPreferences;

/** Endereço do ZapMóvel, token e conta. Fica só neste aparelho. */
public class Config {
    private static final String PREFS = "zapmovel";

    private final SharedPreferences p;

    public Config(Context ctx) {
        p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // URL e conta não são segredo e mudam pouco, então já vêm preenchidas: o
    // usuário só precisa colar o token, que é a única parte sensível.
    public static final String URL_PADRAO = "https://zapmovel.vercel.app";
    public static final String CONTA_PADRAO = "tablet-loja";

    public String url() { return p.getString("url", URL_PADRAO); }
    public String token() { return p.getString("token", ""); }
    public String instance() { return p.getString("instance", CONTA_PADRAO); }

    public boolean isComplete() {
        return !url().isEmpty() && !token().isEmpty() && !instance().isEmpty();
    }

    public void save(String url, String token, String instance) {
        // barra no fim quebraria a concatenação com /api/...
        while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        p.edit()
            .putString("url", url.trim())
            .putString("token", token.trim())
            .putString("instance", instance.trim())
            .apply();
    }

    // --- diagnóstico exibido na tela principal ---------------------------------

    public void recordSent(int n) {
        p.edit()
            .putLong("lastSentAt", System.currentTimeMillis())
            .putInt("totalSent", p.getInt("totalSent", 0) + n)
            .remove("lastError")
            .apply();
    }

    public void recordError(String msg) {
        p.edit().putString("lastError", msg).apply();
    }

    public long lastSentAt() { return p.getLong("lastSentAt", 0); }
    public int totalSent() { return p.getInt("totalSent", 0); }
    public String lastError() { return p.getString("lastError", null); }
}
