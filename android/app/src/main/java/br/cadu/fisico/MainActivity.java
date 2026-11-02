package br.cadu.fisico;

import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Vibrator;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Casca do Cadu físico.
 *
 * Acha o agente do PC por dois caminhos, nesta ordem:
 *  1. CABO  -> http://127.0.0.1:8765 (via "adb reverse" feito pelo agente)
 *  2. WI-FI -> http://IP_DO_PC:8765 com o token de pareamento.
 *     O IP vem do "grito" UDP que o agente faz na rede (porta 8766)
 *     ou do último IP salvo. O token é recebido uma vez pelo cabo.
 * Sem PC: mostra o rosto offline e continua procurando sozinho.
 */
public class MainActivity extends Activity {

    static final int PORTA = 8765;
    static final int PORTA_BEACON = 8766;
    static final String URL_USB = "http://127.0.0.1:" + PORTA + "/";
    static final String URL_OFFLINE = "file:///android_asset/offline.html";

    private WebView web;
    private SharedPreferences prefs;
    private volatile boolean conectado = false;
    private volatile String ipBeacon = null;
    private volatile String urlAtual = null;
    private WifiManager.MulticastLock trava;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("cadu", MODE_PRIVATE);

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
                // PC desligado / cabo solto / Wi-Fi caiu -> rosto offline e volta a procurar
                if (url != null && !url.startsWith("file:")) irOffline();
            }
        });

        setContentView(web);
        telaCheia();
        travarSeForDono();
        web.loadUrl(URL_OFFLINE);

        escutarBeacon();
        procurarPC();
    }

    // ------------------------------------------------------------------ conexão
    private void irOffline() {
        conectado = false;
        urlAtual = null;
        web.post(new Runnable() {
            public void run() { web.loadUrl(URL_OFFLINE); }
        });
    }

    /** Loop em segundo plano: enquanto desconectado, testa cabo e depois Wi-Fi. */
    private void procurarPC() {
        Thread t = new Thread(new Runnable() {
            public void run() {
                while (true) {
                    if (!conectado) {
                        final String url = acharAgente();
                        if (url != null) {
                            conectado = true;
                            urlAtual = url;
                            web.post(new Runnable() {
                                public void run() { web.loadUrl(url); }
                            });
                        }
                    }
                    dormir(3000);
                }
            }
        });
        t.setDaemon(true);
        t.start();
    }

    private String acharAgente() {
        if (ping("http://127.0.0.1:" + PORTA + "/api/ping")) return URL_USB;
        String token = prefs.getString("token", null);
        if (token == null) return null;  // ainda não pareado pelo cabo
        String[] candidatos = {ipBeacon, prefs.getString("ip", null)};
        for (String ip : candidatos) {
            if (ip != null && ping("http://" + ip + ":" + PORTA + "/api/ping")) {
                prefs.edit().putString("ip", ip).apply();
                return "http://" + ip + ":" + PORTA + "/?t=" + token;
            }
        }
        return null;
    }

    private static boolean ping(String endereco) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(endereco).openConnection();
            c.setConnectTimeout(1500);
            c.setReadTimeout(1500);
            return c.getResponseCode() == 200;
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** Escuta o "CADU|8765" que o agente grita na rede a cada 3 s. */
    private void escutarBeacon() {
        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                trava = wm.createMulticastLock("cadu");
                trava.setReferenceCounted(false);
                trava.acquire();
            }
        } catch (Exception ignored) {
        }
        Thread t = new Thread(new Runnable() {
            public void run() {
                while (true) {
                    DatagramSocket sock = null;
                    try {
                        sock = new DatagramSocket(PORTA_BEACON);
                        sock.setBroadcast(true);
                        byte[] buf = new byte[64];
                        while (true) {
                            DatagramPacket p = new DatagramPacket(buf, buf.length);
                            sock.receive(p);
                            String msg = new String(p.getData(), 0, p.getLength(), "UTF-8");
                            if (msg.startsWith("CADU|")) ipBeacon = p.getAddress().getHostAddress();
                        }
                    } catch (Exception e) {
                        dormir(5000);
                    } finally {
                        if (sock != null) sock.close();
                    }
                }
            }
        });
        t.setDaemon(true);
        t.start();
    }

    private static void dormir(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) { }
    }

    // ------------------------------------------------------------------ tela
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
        web.evaluateJavascript("window.aoVoltar && window.aoVoltar()", null);
    }

    // ------------------------------------------------------------------ ponte JS
    /** Funções que a interface (HTML) pode chamar: Cadu.vibrar(30), Cadu.parear(...) */
    class Ponte {
        @JavascriptInterface
        public void vibrar(int ms) {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) v.vibrate(Math.max(5, Math.min(ms, 500)));
        }

        @JavascriptInterface
        public void vibrarPadrao() {  // aviso urgente: três toques
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) v.vibrate(new long[]{0, 120, 90, 120, 90, 220}, -1);
        }

        @JavascriptInterface
        public String versao() { return "0.3-noticias-wifi"; }

        /** Chamado pela interface quando está no cabo: guarda token + IP para o Wi-Fi. */
        @JavascriptInterface
        public void parear(String token, String ip) {
            SharedPreferences.Editor e = prefs.edit();
            if (token != null && token.length() >= 20) e.putString("token", token);
            if (ip != null && ip.length() > 0) e.putString("ip", ip);
            e.apply();
        }

        @JavascriptInterface
        public boolean pareado() { return prefs.getString("token", null) != null; }

        /** A interface perdeu o agente: volta a procurar (cabo ou Wi-Fi). */
        @JavascriptInterface
        public void recarregar() { irOffline(); }
    }
}
