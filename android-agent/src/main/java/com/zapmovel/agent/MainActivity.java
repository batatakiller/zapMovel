package com.zapmovel.agent;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Tela única: configurar o servidor, liberar o acesso e ver se está entrando. */
public class MainActivity extends Activity {
    private Config cfg;
    private EditText eUrl, eToken, eInstance;
    private TextView status;

    @Override protected void onCreate(Bundle s) {
        super.onCreate(s);
        cfg = new Config(this);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        root.setPadding(pad, pad, pad, pad);

        eUrl = campo(root, "Endereço do ZapMóvel", "https://seuapp.vercel.app", cfg.url());
        eToken = campo(root, "Token (ANDROID_INGEST_TOKEN)", "", cfg.token());
        eInstance = campo(root, "Conta (instance)", "tablet-loja", cfg.instance());

        Button salvar = new Button(this);
        salvar.setText("Salvar");
        salvar.setOnClickListener(v -> {
            if (TextUtils.isEmpty(eToken.getText())) {
                Toast.makeText(this, "Falta o token", Toast.LENGTH_SHORT).show();
                return;
            }
            // URL e conta caem no padrão se ficarem em branco — só o token é
            // obrigatório digitar.
            if (TextUtils.isEmpty(eUrl.getText())) eUrl.setText(Config.URL_PADRAO);
            if (TextUtils.isEmpty(eInstance.getText())) eInstance.setText(Config.CONTA_PADRAO);
            cfg.save(eUrl.getText().toString(), eToken.getText().toString(),
                     eInstance.getText().toString());
            Toast.makeText(this, "Salvo", Toast.LENGTH_SHORT).show();
            atualizarStatus();
        });
        root.addView(salvar);

        Button acesso = new Button(this);
        acesso.setText("Liberar acesso às notificações");
        acesso.setOnClickListener(v ->
            startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        root.addView(acesso);

        Button bateria = new Button(this);
        bateria.setText("Tirar da otimização de bateria");
        bateria.setOnClickListener(v -> {
            // Sem isso a MIUI encerra o serviço em algumas horas e a captura
            // para em silêncio, sem erro visível em lugar nenhum.
            try {
                startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            } catch (Exception e) {
                Toast.makeText(this, "Abra manualmente em Configurações > Bateria",
                               Toast.LENGTH_LONG).show();
            }
        });
        root.addView(bateria);

        Button rebind = new Button(this);
        rebind.setText("Reconectar o serviço");
        rebind.setOnClickListener(v -> {
            // Depois de atualizar o app o sistema desfaz o vínculo do listener e
            // nem sempre o refaz sozinho — o serviço fica "autorizado" mas não
            // recebe nada. requestRebind() é a forma oficial de retomar.
            ComponentName cn = new ComponentName(this, WaNotificationListener.class);
            android.service.notification.NotificationListenerService.requestRebind(cn);
            Toast.makeText(this, "Reconexão solicitada", Toast.LENGTH_SHORT).show();
            status.postDelayed(this::atualizarStatus, 1500);
        });
        root.addView(rebind);

        Button autostart = new Button(this);
        autostart.setText("Permitir início automático (MIUI)");
        autostart.setOnClickListener(v -> {
            // A MIUI tem um controle próprio, separado do Android, sem o qual o
            // serviço não sobe depois de reiniciar nem sobrevive muito tempo.
            try {
                Intent i = new Intent();
                i.setComponent(new ComponentName("com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity"));
                startActivity(i);
            } catch (Exception e) {
                Toast.makeText(this, "Abra: Segurança > Permissões > Início automático",
                               Toast.LENGTH_LONG).show();
            }
        });
        root.addView(autostart);

        status = new TextView(this);
        status.setPadding(0, pad, 0, 0);
        status.setTextIsSelectable(true);
        root.addView(status);

        ScrollView sv = new ScrollView(this);
        sv.addView(root);
        setContentView(sv);
    }

    @Override protected void onResume() {
        super.onResume();
        atualizarStatus();
    }

    private EditText campo(LinearLayout root, String rotulo, String dica, String valor) {
        TextView t = new TextView(this);
        t.setText(rotulo);
        root.addView(t);
        EditText e = new EditText(this);
        e.setHint(dica);
        e.setText(valor);
        e.setSingleLine(true);
        root.addView(e);
        return e;
    }

    private void atualizarStatus() {
        StringBuilder sb = new StringBuilder();
        sb.append("Acesso às notificações: ").append(temAcesso() ? "LIBERADO" : "FALTA LIBERAR");
        sb.append("\nConfiguração: ").append(cfg.isComplete() ? "completa" : "incompleta");
        sb.append("\nMensagens enviadas: ").append(cfg.totalSent());
        long t = cfg.lastSentAt();
        sb.append("\nÚltimo envio: ").append(
            t == 0 ? "nenhum ainda"
                   : new SimpleDateFormat("dd/MM HH:mm:ss", Locale.getDefault()).format(new Date(t)));
        String err = cfg.lastError();
        if (err != null) sb.append("\nÚltimo erro: ").append(err);
        status.setText(sb.toString());
    }

    private boolean temAcesso() {
        String ativos = Settings.Secure.getString(getContentResolver(),
                                                  "enabled_notification_listeners");
        if (ativos == null) return false;
        ComponentName me = new ComponentName(this, WaNotificationListener.class);
        return ativos.contains(me.flattenToString()) || ativos.contains(getPackageName());
    }
}
