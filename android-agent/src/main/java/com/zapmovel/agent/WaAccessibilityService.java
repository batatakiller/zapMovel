package com.zapmovel.agent;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import android.os.Bundle;
import android.os.PowerManager;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Serviço de Acessibilidade do Android para envio autônomo.
 * Usado quando a conversa não possui notificação ativa (ex: contatos novos/antigos).
 */
public class WaAccessibilityService extends AccessibilityService {
    private static final String TAG = "ZapAgentAccess";
    private static WaAccessibilityService instance;

    private static class PendingSend {
        final String phone;
        final String text;
        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicReference<String> error = new AtomicReference<>(null);
        boolean clicked = false;

        PendingSend(String phone, String text) {
            this.phone = phone;
            this.text = text;
        }
    }

    private static PendingSend activeSend = null;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
        Log.i(TAG, "Serviço de Acessibilidade do ZapMóvel conectado");
    }

    @Override
    public boolean onUnbind(Intent intent) {
        instance = null;
        Log.i(TAG, "Serviço de Acessibilidade desconectado");
        return super.onUnbind(intent);
    }

    public static boolean isRunning() {
        return instance != null;
    }

    /**
     * Tenta enviar uma mensagem via Intent + Acessibilidade.
     * Bloqueia a thread chamadora até concluir ou dar timeout (máx 15s).
     * Devolve null em caso de sucesso ou a mensagem de erro.
     */
    public static String enviarViaAcessibilidade(Context ctx, String jid, String texto) {
        if (!isRunning()) {
            return "serviço de acessibilidade não está ativado nas configurações do Android";
        }

        String phone = jidToPhone(jid);
        if (phone.isEmpty()) {
            return "JID inválido para envio por telefone: " + jid;
        }

        PendingSend send = new PendingSend(phone, texto);
        synchronized (WaAccessibilityService.class) {
            activeSend = send;
        }

        try {
            // Se a tela do tablet estiver apagada, acende temporariamente
            try {
                PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
                if (pm != null && !pm.isInteractive()) {
                    @SuppressWarnings("deprecation")
                    PowerManager.WakeLock wl = pm.newWakeLock(
                        PowerManager.FULL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE,
                        "ZapAgent:WakeUp"
                    );
                    wl.acquire(5000);
                }
            } catch (Exception e) {
                Log.w(TAG, "Não foi possível acender a tela: " + e.getMessage());
            }

            // Fecha painéis de notificação ou diálogos do sistema que possam estar abertos
            try {
                ctx.sendBroadcast(new Intent(Intent.ACTION_CLOSE_SYSTEM_DIALOGS));
            } catch (Exception e) {}

            // Monta a Intent de envio direto pelo esquema nativo do WhatsApp
            String encodedText = URLEncoder.encode(texto, StandardCharsets.UTF_8.name());
            String uriStr = "whatsapp://send?phone=" + phone + "&text=" + encodedText;
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uriStr));
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

            // Força o envio pelo WhatsApp Business (com.whatsapp.w4b)
            intent.setPackage("com.whatsapp.w4b");
            ctx.startActivity(intent);
            Log.i(TAG, "Intent nativa whatsapp:// disparada para " + phone);

            // Aguarda até 15 segundos pela conclusão da automação de clique
            boolean ok = send.latch.await(15, TimeUnit.SECONDS);
            if (!ok) {
                return "timeout aguardando carregamento da tela do WhatsApp";
            }
            return send.error.get();
        } catch (Exception e) {
            Log.e(TAG, "Falha ao disparar intent", e);
            return e.getClass().getSimpleName() + ": " + e.getMessage();
        } finally {
            synchronized (WaAccessibilityService.class) {
                if (activeSend == send) activeSend = null;
            }
        }
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        PendingSend current;
        synchronized (WaAccessibilityService.class) {
            current = activeSend;
        }

        if (current == null || current.clicked) return;

        CharSequence pkg = event.getPackageName();
        if (pkg == null) return;
        String pkgName = pkg.toString();

        if (!pkgName.contains("whatsapp")) return;

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;

        AccessibilityNodeInfo sendButton = findSendButton(root);
        if (sendButton != null) {
            current.clicked = true;
            Log.i(TAG, "Botão de enviar localizado (" + sendButton.getViewIdResourceName() + "). Aplicando pausa humana...");

            // Pausa humana de 2.5 segundos antes de clicar
            mainHandler.postDelayed(() -> {
                try {
                    boolean success = performClickSafely(sendButton);
                    Log.i(TAG, "Clique no botão de enviar: " + success);
                    if (!success) {
                        current.error.set("falha ao clicar no botão de enviar");
                    }
                } catch (Exception e) {
                    current.error.set("erro ao clicar: " + e.getMessage());
                } finally {
                    current.latch.countDown();
                }
            }, 2500);
        }
    }

    private boolean performClickSafely(AccessibilityNodeInfo node) {
        if (node == null) return false;
        if (node.isClickable()) {
            return node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null && child.isClickable()) {
                return child.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            }
        }
        AccessibilityNodeInfo parent = node.getParent();
        if (parent != null && parent.isClickable()) {
            return parent.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        }
        return node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
    }

    private AccessibilityNodeInfo findSendButton(AccessibilityNodeInfo node) {
        if (node == null) return null;

        String viewId = node.getViewIdResourceName();
        CharSequence desc = node.getContentDescription();

        // Ignora botão de microfone / nota de voz
        if (viewId != null && viewId.contains("voice_note")) {
            return null;
        }
        if (desc != null) {
            String d = desc.toString().toLowerCase();
            if (d.contains("voz") || d.contains("voice")) {
                return null;
            }
            if (d.equals("enviar") || d.equals("send")) {
                Log.i(TAG, "Match por desc exata: " + desc);
                return node;
            }
        }

        if (viewId != null && (
                viewId.endsWith(":id/send") ||
                viewId.endsWith(":id/entry_send")
        )) {
            Log.i(TAG, "Match por viewId de envio: " + viewId);
            return node;
        }

        // Busca recursiva nos filhos
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            AccessibilityNodeInfo result = findSendButton(child);
            if (result != null) return result;
        }

        return null;
    }

    @Override
    public void onInterrupt() {
        Log.w(TAG, "Serviço de Acessibilidade interrompido");
    }

    private static String jidToPhone(String jid) {
        if (jid == null) return "";
        String clean = jid.split("@")[0].replaceAll("[^0-9]", "");
        return clean;
    }
}
