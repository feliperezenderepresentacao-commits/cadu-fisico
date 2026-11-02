package br.cadu.fisico;

import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.os.Vibrator;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Casca do Cadu físico.
 * Mostra em tela cheia a interface servida pelo agente do PC
 * (chega pelo cabo USB via "adb reverse tcp:8765 tcp:8765").
 * Se o PC não responder, mostra o rosto offline e tenta de novo sozinho.
 */
public class MainActivity extends Activity {

    static final String URL_AGENTE = "http://127.0.0.1:8765/";
    static final String URL_OFFLINE = "file:///android_asset/offline.html";

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_FULLSCREEN
                | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);

        web = new WebView(this);
        web.setBackgroundColor(0xFF000000);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setMediaPlaybackRequiresUserGesture(false);

        web.addJavascriptInterface(new Ponte(), "Cadu");
        web.setWebViewClient(new WebViewClient() {
            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int code, String desc, String url) {
                // PC desligado / cabo solto / agente parado -> rosto offline
                if (url != null && url.startsWith(URL_AGENTE)) {
                    view.loadUrl(URL_OFFLINE);
                }
            }
        });

        setContentView(web);
        telaCheia();
        travarSeForDono();
        web.loadUrl(URL_AGENTE);
    }

    /** Esconde barra de status e botões (modo imersivo). */
    private void telaCheia() {
        if (Build.VERSION.SDK_INT >= 19) {
            web.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    /** Se o app for "dono do aparelho", trava a tela no Cadu (quiosque). */
    private void travarSeForDono() {
        try {
            DevicePolicyManager dpm = (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
            if (dpm != null && dpm.isDeviceOwnerApp(getPackageName())) {
                dpm.setLockTaskPackages(new ComponentName(this, AdminReceiver.class),
                        new String[]{getPackageName()});
                startLockTask();
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) telaCheia();
    }

    @Override
    public void onBackPressed() {
        // Voltar não sai do Cadu: avisa a interface (ex.: volta ao rosto).
        web.evaluateJavascript("window.aoVoltar && window.aoVoltar()", null);
    }

    /** Funções do aparelho que a interface (HTML) pode chamar: Cadu.vibrar(30) */
    class Ponte {
        @JavascriptInterface
        public void vibrar(int ms) {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) v.vibrate(Math.max(5, Math.min(ms, 500)));
        }

        @JavascriptInterface
        public String versao() {
            return "0.1-fase1";
        }

        @JavascriptInterface
        public void recarregar() {
            web.post(new Runnable() {
                public void run() { web.loadUrl(URL_AGENTE); }
            });
        }
    }
}
